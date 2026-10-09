import type { CatalogFilters, CatalogGridItem, CatalogSearchResult } from "@/lib/products/queries";
import type { LandingInsights } from "@/lib/products/landing-insights";

export type CatalogMetaResponse = {
  stats: { visible: number; scored: number; zepto: number };
  filters: CatalogFilters;
};

const SEARCH_CACHE_MS = 90_000;
const searchCache = new Map<string, { at: number; data: CatalogSearchResult }>();
const inflight = new Map<string, Promise<CatalogSearchResult>>();

function searchCacheKey(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === false) continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

const META_CACHE_MS = 120_000;
const metaCache = new Map<string, { at: number; data: CatalogMetaResponse }>();

export async function fetchCatalogMeta(category?: string): Promise<CatalogMetaResponse> {
  const key = category ?? "";
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < META_CACHE_MS) return hit.data;

  const params = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`/api/catalog/meta${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as CatalogMetaResponse;
  metaCache.set(key, { at: Date.now(), data });
  return data;
}

export async function fetchCatalogSearch(
  params: Record<string, string | number | boolean | undefined>,
): Promise<CatalogSearchResult> {
  const key = searchCacheKey(params);
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.data;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const sp = new URLSearchParams(key);
    const res = await fetch(`/api/catalog/search?${sp.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as CatalogSearchResult;
    searchCache.set(key, { at: Date.now(), data });
    if (searchCache.size > 48) {
      const oldest = [...searchCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldest) searchCache.delete(oldest);
    }
    return data;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/** Warm the next page while the user browses page 1. */
export function prefetchCatalogSearch(
  params: Record<string, string | number | boolean | undefined>,
): void {
  const key = searchCacheKey(params);
  if (searchCache.has(key)) return;
  void fetchCatalogSearch(params).catch(() => {});
}

let landingCache: { at: number; data: LandingInsights } | null = null;
const LANDING_CACHE_MS = 300_000;

export async function fetchLandingInsights(): Promise<LandingInsights> {
  if (landingCache && Date.now() - landingCache.at < LANDING_CACHE_MS) {
    return landingCache.data;
  }
  const res = await fetch("/api/landing");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as LandingInsights;
  landingCache = { at: Date.now(), data };
  return data;
}

export type { CatalogGridItem, CatalogSearchResult, LandingInsights };
