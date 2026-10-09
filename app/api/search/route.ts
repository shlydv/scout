import { NextRequest, NextResponse } from "next/server";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";
import { adminClient } from "@/lib/supabase/admin";
import { searchInputSchema } from "@/lib/search/input";
import { getCachedResult, resultCacheKey, setCachedResult } from "@/lib/search/result-cache";
import { plannedSearch } from "@/lib/search/planned/search";
import { presentSearch, type SearchResponse } from "@/lib/search/planned/present";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Next to the Supabase database (ap-southeast-1); search makes several DB round trips.
export const preferredRegion = "sin1";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(req: NextRequest) {
  const input = searchInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid search request", code: "invalid_request" }, { status: 400, headers: HEADERS });
  const q = (input.data.q ?? input.data.prompt)!;
  const limit = input.data.limit ?? 24;
  const preferences = input.data.preferences ?? null;
  const key = resultCacheKey(q, limit, preferences);
  const cached = getCachedResult<SearchResponse>(key);
  if (cached) return NextResponse.json(cached, { headers: HEADERS });

  // Search is free for guests and signed-in users; identity is only used for history.
  try {
    const search = await plannedSearch(q, { limit, preferences });
    const result = presentSearch(search);
    if (!result.degraded) setCachedResult(key, result);
    if (process.env.SEARCH_TELEMETRY === "1") {
      console.log(JSON.stringify({ type: "planned_search", ...search.timings, llm: search.llm, items: result.items.length,
        unconfirmed: result.unconfirmed.length, relaxed: search.relaxed, intent: search.plan.intent }));
    }
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      void (async () => {
        const client = supabaseFromBearer(authHeader);
        if (!client) return;
        const { data } = await client.auth.getUser();
        if (!data.user) return;
        await adminClient().from("search_history").insert({
          user_id: data.user.id, query: q.slice(0, 200), intent_tier: search.plan.intent,
          rank_source: "planned", result_count: result.items.length,
        });
      })().catch(() => console.warn("[search] history unavailable"));
    }
    return NextResponse.json(result, { headers: HEADERS });
  } catch (error) {
    console.error("[search]", error instanceof Error ? `${error.name}: ${error.message}` : "SearchError");
    return NextResponse.json({ error: "Search is temporarily unavailable. Please try again in a moment.", code: "search_unavailable" }, { status: 503, headers: HEADERS });
  }
}
