import type { AiSearchResult } from "@/lib/search/ai-search";
import type { QueryParseResult } from "@/lib/search/query-parse";

const PARSE_TTL_MS = 24 * 60 * 60 * 1000;
const RESULT_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { at: number; value: T };

const parseCache = new Map<string, CacheEntry<QueryParseResult>>();
const resultCache = new Map<string, CacheEntry<AiSearchResult>>();

/** Bump when rank/merge logic changes so warm serverless instances drop stale results. */
const CACHE_VERSION = "v15-clef-evidence";

function normalizeKey(prompt: string): string {
  return `${CACHE_VERSION}:${prompt.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function get<T>(map: Map<string, CacheEntry<T>>, key: string, ttlMs: number): T | null {
  const hit = map.get(key);
  if (!hit || Date.now() - hit.at > ttlMs) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function set<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, max = 64) {
  map.set(key, { at: Date.now(), value });
  if (map.size > max) {
    const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest) map.delete(oldest);
  }
}

export function getCachedParse(prompt: string): QueryParseResult | null {
  return get(parseCache, normalizeKey(prompt), PARSE_TTL_MS);
}

export function setCachedParse(prompt: string, value: QueryParseResult) {
  set(parseCache, normalizeKey(prompt), value);
}

import type { AiSearchPreferences } from "@/lib/search/ai-usage";

/** Stable, order-independent fingerprint of user preferences for cache isolation. */
function prefKey(prefs: AiSearchPreferences | null | undefined): string {
  if (!prefs || !Object.keys(prefs).length) return "";
  return JSON.stringify({
    diet: prefs.diet ?? null, budget: prefs.budget ?? null,
    healthContexts: [...(prefs.healthContexts ?? [])].sort(),
    avoidIngredients: [...(prefs.avoidIngredients ?? [])].sort(),
  });
}

export function getCachedAiResult(
  prompt: string,
  limit: number,
  tier: string,
  prefs?: AiSearchPreferences | null,
): AiSearchResult | null {
  const pk = prefKey(prefs);
  return get(resultCache, `${normalizeKey(prompt)}|${tier}|${limit}|${pk}`, RESULT_TTL_MS);
}

export function setCachedAiResult(
  prompt: string,
  limit: number,
  tier: string,
  value: AiSearchResult,
  prefs?: AiSearchPreferences | null,
) {
  const pk = prefKey(prefs);
  set(resultCache, `${normalizeKey(prompt)}|${tier}|${limit}|${pk}`, value);
}
