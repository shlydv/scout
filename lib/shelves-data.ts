import { unstable_cache } from "next/cache";
import { plannedSearch } from "@/lib/search/planned/search";
import { presentSearch, type SearchResponse } from "@/lib/search/planned/present";
import { shelfBySlug } from "@/lib/shelves";

const SHELF_TIMEOUT_MS = 40_000;

const cachedShelf = unstable_cache(
  async (slug: string): Promise<SearchResponse> => {
    const shelf = shelfBySlug(slug);
    if (!shelf) throw new Error(`unknown shelf ${slug}`);
    const result = await Promise.race([
      plannedSearch(shelf.query, { limit: 24 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shelf search timed out")), SHELF_TIMEOUT_MS)),
    ]);
    const data = presentSearch(result);
    if (shelf.rankBy === "score") data.items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    // Throwing keeps an empty or degraded result out of the day-long cache.
    if (data.degraded || data.items.length === 0) throw new Error("shelf came back empty");
    return data;
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
