import { fetchAiSearch } from "@/lib/api";
import { readAiSearchPreferences } from "@/lib/ai-usage";
import type { AiSearchResult, CatalogMeta } from "@/types/api";

const CATALOG_PAGE_SIZE = 24;

/**
 * Same routing as web `catalog-view` `runAiSearch`:
 * always POST `/api/search/ai`; the server owns all decision logic.
 */
export async function runCatalogSearch(
  query: string,
  token: string | null,
  _catalogMeta: CatalogMeta | null,
  limit = CATALOG_PAGE_SIZE,
): Promise<AiSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new Error("Enter at least 2 characters to search.");
  }


  const preferences = await readAiSearchPreferences();
  const tier = "structured";

  const result = await fetchAiSearch(trimmed, token, limit, tier, preferences);
  return result;
}
