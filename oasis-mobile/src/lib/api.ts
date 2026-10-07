import { API_BASE } from "@/lib/config";
import type { AiSearchPreferences } from "@/lib/ai-usage";
import type {
  AiSearchResult,
  CatalogMeta,
  CatalogProduct,
  CatalogSearchResult,
  LandingInsights,
  MeResponse,
  ProductDetail,
} from "@/types/api";

const DEFAULT_TIMEOUT_MS = 25_000;
/** Match web `fetchAiCatalogSearch` in `lib/products/catalog-api.ts`. */
const AI_SEARCH_TIMEOUT_MS = 55_000;

export function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || /timed out|timeout/i.test(e.message));
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string | null; timeoutMs?: number },
): Promise<T> {
  const { token, timeoutMs: timeoutOverride, ...fetchInit } = init ?? {};
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(fetchInit.headers as Record<string, string> | undefined),
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const timeoutMs = timeoutOverride ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchInit,
      headers,
      signal: controller.signal,
    });
  } catch (e) {
    if (isTimeoutError(e)) {
      throw new Error("Search took too long — try again in a moment.");
    }
    if (e instanceof TypeError) {
      const hint = API_BASE.startsWith("https://")
        ? "Check phone internet access, then run `pnpm mobile:env` and `pnpm mobile:start` (Expo tunnel)."
        : "Local API needs same Wi‑Fi + `pnpm dev:lan`. For worldwide QR use production: `pnpm mobile:env` then `pnpm mobile:start`.";
      throw new Error(`Cannot reach Scout API at ${API_BASE}. ${hint}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: string }).error)
        : `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.status = res.status;
    if (body && typeof body === "object" && "code" in body) {
      err.code = String((body as { code: string }).code);
    }
    throw err;
  }
  return body as T;
}

export function fetchLanding(): Promise<LandingInsights> {
  return apiFetch("/api/landing");
}

export function fetchCatalogMeta(): Promise<CatalogMeta> {
  return apiFetch("/api/catalog/meta");
}

export function fetchCatalogSearch(params: Record<string, string | number>): Promise<CatalogSearchResult> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== "" && v !== undefined) sp.set(k, String(v));
  }
  return apiFetch(`/api/catalog/search?${sp.toString()}`);
}

export function fetchProduct(slug: string): Promise<ProductDetail> {
  return apiFetch(`/api/products/${encodeURIComponent(slug)}`);
}

export function fetchProductsBySlugs(slugs: string[]): Promise<CatalogProduct[]> {
  if (!slugs.length) return Promise.resolve([]);
  return apiFetch(`/api/products?slugs=${slugs.map(encodeURIComponent).join(",")}`);
}

export function fetchMe(token: string): Promise<MeResponse> {
  return apiFetch("/api/me", { token });
}

/** Same contract as web `fetchAiCatalogSearch`. */
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

export function fetchCanonicalVariants(productId: string): Promise<CanonicalVariantItem[]> {
  return apiFetch(`/api/search/canonical?product_id=${encodeURIComponent(productId)}`).then(
    (body) => (body as { items?: CanonicalVariantItem[] }).items ?? [],
  );
}

export function fetchAiSearch(
  prompt: string,
  token: string | null,
  limit = 24,
  tier: "structured" | "complex" = "structured",
  preferences?: AiSearchPreferences | null,
): Promise<AiSearchResult> {
  return apiFetch("/api/search/ai", {
    method: "POST",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify({
      prompt,
      limit,
      tier,
      preferences: preferences ?? undefined,
    }),
    token,
    timeoutMs: AI_SEARCH_TIMEOUT_MS,
  });
}

type RawSwapRow = {
  product: CatalogProduct;
  goalFit: number;
  deltas: string[];
};

type RawSwapsResponse = {
  goal: string;
  swaps: Record<string, RawSwapRow[]>;
};

function mapSwapRow(row: RawSwapRow): import("@/types/api").BasketSwap {
  const p = row.product;
  return {
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    image_urls: p.image_urls ?? [],
    price_inr: p.price_inr,
    core_scores: p.core_scores,
    goal_fit: row.goalFit,
    deltas: row.deltas ?? [],
  };
}

export async function fetchSwaps(
  slugs: string[],
  goal = "balanced",
): Promise<import("@/types/api").SwapsResponse> {
  if (!slugs.length) {
    return Promise.resolve({ goal, swaps: {} });
  }
  const q = `slugs=${slugs.map(encodeURIComponent).join(",")}&goal=${encodeURIComponent(goal)}`;
  const raw = await apiFetch<RawSwapsResponse>(`/api/swaps?${q}`);
  const swaps: Record<string, import("@/types/api").BasketSwap[]> = {};
  for (const [slug, rows] of Object.entries(raw.swaps ?? {})) {
    swaps[slug] = (rows ?? []).map(mapSwapRow);
  }
  return { goal: raw.goal, swaps };
}
