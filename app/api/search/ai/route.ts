import { NextRequest, NextResponse } from "next/server";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";
import { adminClient } from "@/lib/supabase/admin";
import { getCachedAiResult, setCachedAiResult } from "@/lib/search/search-cache";
import { searchInputSchema } from "@/lib/search/decision/input";
import { DecisionUnavailableError } from "@/lib/search/decision/cloudflare";
import { runSearchV2 } from "@/lib/search/v2/pipeline";
import { searchV2ToAiResult } from "@/lib/search/v2/adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1";
const CACHE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(req: NextRequest) {
  const input = searchInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid search request", code: "invalid_request" }, { status: 400 });
  const { prompt, limit = 24, preferences = null } = input.data;
  const cached = getCachedAiResult(prompt, limit, "structured", preferences);
  if (cached) return NextResponse.json(cached, { headers: CACHE_HEADERS });

  // Search is free for guests and signed-in users. Identity is only for history.
  try {
    const search = await runSearchV2(prompt, { limit, preferences });
    const result = await searchV2ToAiResult(search, { limit });
    setCachedAiResult(prompt, limit, "structured", result, preferences);
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      void (async () => {
        const client = supabaseFromBearer(authHeader);
        if (!client) return;
        const { data } = await client.auth.getUser();
        if (!data.user) return;
        await adminClient().from("search_history").insert({
          user_id: data.user.id, query: prompt.slice(0, 200), intent_tier: "structured",
          rank_source: result.rank_source, result_count: result.items.length,
        });
      })().catch(() => console.warn("[search] history unavailable"));
    }
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error("[search/ai]", error instanceof Error ? error.name : "SearchError");
    return NextResponse.json({
      error: error instanceof DecisionUnavailableError ? error.message : "Search is temporarily unavailable. Please try again later.",
      code: "search_unavailable",
    }, { status: 503, headers: CACHE_HEADERS });
  }
}
