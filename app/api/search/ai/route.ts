import { NextRequest, NextResponse } from "next/server";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";
import { adminClient } from "@/lib/supabase/admin";
import { getCachedAiResult, setCachedAiResult } from "@/lib/search/search-cache";
import { searchInputSchema } from "@/lib/search/decision/input";
import { plannedSearch } from "@/lib/search/planned/search";
import { plannedToAiResult } from "@/lib/search/planned/adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Next to the Supabase database (ap-southeast-1); search makes several DB round trips.
export const preferredRegion = "sin1";
const CACHE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(req: NextRequest) {
  const input = searchInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid search request", code: "invalid_request" }, { status: 400 });
  const { prompt, limit = 24, preferences = null } = input.data;
  const cached = getCachedAiResult(prompt, limit, "structured", preferences);
  if (cached) return NextResponse.json(cached, { headers: CACHE_HEADERS });

  // Search is free for guests and signed-in users. Identity is only for history.
  try {
    const search = await plannedSearch(prompt, { limit, preferences });
    const result = plannedToAiResult(search, limit);
    if (process.env.SEARCH_TELEMETRY === "1") {
      console.log(JSON.stringify({ type: "planned_search", ...search.timings, llm: search.llm, items: search.items.length,
        unconfirmed: search.unconfirmed.length, relaxed: search.relaxed, intent: search.plan.intent }));
    }
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
      error: "Search is temporarily unavailable. Please try again later.",
      code: "search_unavailable",
    }, { status: 503, headers: CACHE_HEADERS });
  }
}
