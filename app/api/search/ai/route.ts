import { NextRequest, NextResponse } from "next/server";
import {
  ANON_COOKIE_NAME,
  ANON_FREE_SEARCHES,
  ANON_WINDOW_MS,
  anonCookieValue,
  readAnonWindow,
} from "@/lib/auth/anon-gate";
import { consumeAiSearch } from "@/lib/auth/profile";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";
import { adminClient } from "@/lib/supabase/admin";
import {
  getCachedAiResult,
  setCachedAiResult,
} from "@/lib/search/search-cache";
import type { AiSearchPreferences } from "@/lib/search/ai-usage";
import { runSearchV2 } from "@/lib/search/v2/pipeline";
import { searchV2ToAiResult } from "@/lib/search/v2/adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

// In-memory rate limiter for anonymous requests (3 free per hour, per IP)
const anonRateLimit = new Map<string, { start: number; count: number }>();

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    prompt?: unknown;
    limit?: unknown;
    tier?: unknown;
    preferences?: AiSearchPreferences | null;
  } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 2) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const limit = typeof body?.limit === "number" ? body.limit : undefined;
  const tier =
    body?.tier === "structured" || body?.tier === "complex" ? body.tier : "structured";

  const preferences = body?.preferences ?? null;

  // Cache key includes preferences so User A's vegan-filtered results never leak to User B.
  const cached = getCachedAiResult(prompt, limit ?? 24, tier, preferences);
  if (cached) {
    return NextResponse.json(cached, { headers: CACHE_HEADERS });
  }

  // Try auth from Bearer token (sent by client with session.access_token)
  let userId: string | null = null;
  const authHeader = req.headers.get("authorization");
  const client = supabaseFromBearer(authHeader);
  if (client) {
    const { data: userData } = await client.auth.getUser();
    if (userData.user) {
      userId = userData.user.id;
      const gate = await consumeAiSearch(client, userData.user.id, userData.user.email);
      if (!gate.ok) {
        return NextResponse.json(
          { error: gate.reason, code: "quota_exceeded" },
          { status: 402 },
        );
      }
    }
  }
  
  let anonCookie: string | null = null;
  if (!userId) {
    // Anonymous users: 3 free searches/hour, then prompt sign-in. The count
    // lives in a signed cookie (survives cold starts & multiple instances);
    // the per-instance IP map is a second signal for cookie-clearers.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const anonKey = `anon:${ip}`;
    const now = Date.now();
    if (anonRateLimit.size > 1000) {
      for (const [k, w] of anonRateLimit) {
        if (now - w.start >= ANON_WINDOW_MS) anonRateLimit.delete(k);
      }
    }
    const cookieWindow = readAnonWindow(req.cookies.get(ANON_COOKIE_NAME)?.value, now);
    let mapWindow = anonRateLimit.get(anonKey);
    if (!mapWindow || now - mapWindow.start >= ANON_WINDOW_MS) {
      mapWindow = { start: now, count: 0 };
      anonRateLimit.set(anonKey, mapWindow);
    }
    if (Math.max(cookieWindow.count, mapWindow.count) >= ANON_FREE_SEARCHES) {
      return NextResponse.json(
        {
          error: "Sign in for 5 free Ask Scout searches a day.",
          code: "sign_in_required",
        },
        { status: 401 },
      );
    }
    mapWindow.count++;
    anonCookie = anonCookieValue({ start: cookieWindow.start, count: cookieWindow.count + 1 });
  }

  try {
    const v2Result = await runSearchV2(prompt, { limit, preferences });
    const result = await searchV2ToAiResult(v2Result, { limit, parseSource: "heuristic" });
    setCachedAiResult(prompt, limit ?? 24, tier, result, preferences);

    // Record search in history for logged-in users (fire-and-forget, non-blocking)
    if (userId) {
      const supabase = adminClient();
      void supabase.from("search_history").insert({
        user_id: userId,
        query: prompt.slice(0, 200),
        intent_tier: result.intent_tier ?? tier,
        rank_source: result.rank_source,
        result_count: result.items.length,
      });
    }

    const res = NextResponse.json(result, { headers: CACHE_HEADERS });
    if (anonCookie) {
      res.cookies.set(ANON_COOKIE_NAME, anonCookie, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: ANON_WINDOW_MS / 1000,
        path: "/",
      });
    }
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI search failed";
    console.error("[search/ai]", message);
    // Failed searches are not charged: no cookie write, so the visitor keeps the credit.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
