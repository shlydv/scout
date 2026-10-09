/** Per-instance cache of finished search responses (short TTL, bounded size). */
import type { AiSearchPreferences } from "@/lib/search/preferences";

const TTL_MS = 5 * 60_000;
const MAX = 128;
/** Bump when ranking or response shape changes so warm instances drop stale results. */
const VERSION = "planned-v2";
const cache = new Map<string, { at: number; value: unknown }>();

export function resultCacheKey(q: string, limit: number, prefs: AiSearchPreferences | null | undefined): string {
  const p = prefs && Object.keys(prefs).length
    ? JSON.stringify({ diet: prefs.diet ?? null, budget: prefs.budget ?? null, health: [...(prefs.healthContexts ?? [])].sort(), avoid: [...(prefs.avoidIngredients ?? [])].sort() })
    : "";
  return `${VERSION}|${q.toLowerCase().replace(/\s+/g, " ").trim()}|${limit}|${p}`;
}

export function getCachedResult<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) { cache.delete(key); return null; }
  return hit.value as T;
}

export function setCachedResult(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
}
