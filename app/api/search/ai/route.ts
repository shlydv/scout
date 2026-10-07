import { NextRequest, NextResponse } from "next/server";
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
    }
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

    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI search failed";
    console.error("[search/ai]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
