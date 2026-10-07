import type { CatalogFilters, CatalogGridItem, CatalogSearchResult } from "@/lib/products/queries";
import type { AiSearchResult } from "@/lib/search/ai-search";
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

const AI_SEARCH_FETCH_MS = 55_000;

/** Carries the API's machine-readable error code
 *  so the UI can render the right gate instead of a generic failure. */
export class AiSearchError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "AiSearchError";
    this.code = code;
  }
}

export async function fetchAiCatalogSearch(
  prompt: string,
  limit = 24,
  tier?: "structured" | "complex",
  preferences?: import("@/lib/search/ai-usage").AiSearchPreferences | null,
  accessToken?: string | null,
): Promise<AiSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SEARCH_FETCH_MS);
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (accessToken) headers["authorization"] = `Bearer ${accessToken}`;
  const res = await fetch("/api/search/ai", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, limit, tier, preferences: preferences ?? undefined }),
    signal: controller.signal,
    cache: "no-store",
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new AiSearchError(body?.error ?? `HTTP ${res.status}`, body?.code ?? null);
  }
  return (await res.json()) as AiSearchResult;
}

export type CanonicalVariantItem = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  net_weight: string | null;
  price_inr: number | null;
  mrp_inr: number | null;
  image_urls: string[];
  scout_score: number | null;
};

export async function fetchCanonicalVariants(productId: string): Promise<CanonicalVariantItem[]> {
  const res = await fetch(`/api/search/canonical?product_id=${encodeURIComponent(productId)}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { items?: CanonicalVariantItem[] };
  return body.items ?? [];
}

/** §10 popularity loop — fire-and-forget click/save tracking */
export function trackSearchInteraction(productId: string, kind: "click" | "save"): void {
  let goal_id: string | null = null;
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem("scout_last_search_v2");
      if (raw) goal_id = (JSON.parse(raw) as { goal_id?: string }).goal_id ?? null;
    } catch {
      // ignore
    }
  }
  void fetch("/api/search/interaction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product_id: productId, kind, goal_id }),
    keepalive: true,
  }).catch(() => {});
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

export type { CatalogGridItem, CatalogSearchResult, AiSearchResult, LandingInsights };
