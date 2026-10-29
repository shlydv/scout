import { unstable_cache } from "next/cache";
import { plannedSearch } from "@/lib/search/planned/search";
import { presentSearch, type SearchResponse } from "@/lib/search/planned/present";
import { shelfBySlug } from "@/lib/shelves";
import { KeyedWorkQueue, throwIfAborted } from "@/lib/search/planned/runtime";

const SHELF_TIMEOUT_MS = 40_000;
// Generation is expensive (SQL + planner + verifier). Bound misses within each
// serverless instance; persistent Next cache hits do not enter this queue.
const shelfGeneration = new KeyedWorkQueue<SearchResponse>(2, 12);

const cachedShelf = unstable_cache(
  async (slug: string): Promise<SearchResponse> => {
    const shelf = shelfBySlug(slug);
    if (!shelf) throw new Error(`unknown shelf ${slug}`);
    return shelfGeneration.run(slug, async signal => {
      const result = await plannedSearch(shelf.query, { limit: 24, signal, timeoutMs: SHELF_TIMEOUT_MS });
      throwIfAborted(signal);
      const data = presentSearch(result);
      if (shelf.rankBy === "score") data.items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      // Throwing keeps empty, cancelled or degraded results out of the daily cache.
      if (data.degraded || data.items.length === 0) throw new Error("shelf came back empty");
      return data;
    }, { timeoutMs: SHELF_TIMEOUT_MS });
  },
  ["goal-shelf-v4-verdict"],
  { revalidate: 86400 },
);

/**
 * One shelf's results, shared by /shelves and /shelves/[slug] and cached for a
 * day (each refresh is one planned search). Null when the search fails, so a
 * page can still render.
 */
export async function getShelf(slug: string): Promise<SearchResponse | null> {
  try {
    return await cachedShelf(slug);
  } catch (e) {
    console.error("[shelf]", slug, e instanceof Error ? e.message : e);
    return null;
  }
}
