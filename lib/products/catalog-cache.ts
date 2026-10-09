import { unstable_cache } from "next/cache";
import { collapseVariants } from "@/lib/products/variants";
import { dietFromParam } from "@/lib/diet/types";
import { goalFromParam } from "@/lib/goals/types";
import { buildLandingInsights } from "@/lib/products/landing-insights";
import { sortFromParam } from "@/lib/products/catalog-sort";
import {
  getCatalogMeta,
  getScoredCatalogStats,
  getScoredProductsForInsights,
  getScoredVerdictStats,
  searchCatalogGrid,
  type CatalogMeta,
  type CatalogSearchResult,
  type ScoredVerdictStats,
} from "@/lib/products/queries";
import type { Grade } from "@/lib/supabase/types";

export async function getCachedCatalogMeta(category?: string): Promise<CatalogMeta> {
  if (category) {
    return unstable_cache(() => getCatalogMeta(category), ["catalog-meta", category], {
      revalidate: 3600, tags: ["catalog-meta"],
    })();
  }
  return unstable_cache(() => getCatalogMeta(), ["catalog-meta"], {
    revalidate: 3600, tags: ["catalog-meta"],
  })();
}

export async function getCachedScoredCatalogForInsights() {
  return unstable_cache(
    () => getScoredProductsForInsights(),
    ["catalog-insights-scored-v3"],
    { revalidate: 300 },
  )();
}

/** Exact verdict counts over the full catalog — for honest insights headlines. */
export async function getCachedScoredVerdictStats(): Promise<ScoredVerdictStats> {
  return unstable_cache(() => getScoredVerdictStats(), ["catalog-verdict-stats-v1"], {
    revalidate: 600,
  })();
}

export async function getCachedLandingInsights() {
  return unstable_cache(
    async () => {
      const [products, stats] = await Promise.all([
        getScoredProductsForInsights(),
        getScoredCatalogStats().catch(() => ({ totalScored: 0 })),
      ]);
      return buildLandingInsights(products, {
        totalScored: stats.totalScored || products.filter((p) => p.core_scores).length,
      });
    },
    // v4: category hrefs no longer gate on verdict=daily_staple (was silently
    // empty for treat/skip-heavy aisles) + diversified staples.
    ["catalog-landing-insights-v4"],
    { revalidate: 3600 },
  )();
}

function parseGrade(raw: string | undefined): Grade | "" {
  const g = (raw ?? "").toUpperCase();
  return g === "A" || g === "B" || g === "C" || g === "D" ? (g as Grade) : "";
}

export type CatalogSearchParams = {
  q?: string;
  category?: string;
  subcategory?: string;
  usecase?: string;
  brand?: string;
  scored?: string;
  labelResolved?: string;
  deepseek?: string;
  min?: string;
  maxprice?: string;
  grade?: string;
  sort?: string;
  goal?: string;
  diet?: string;
  sublabel?: string;
  verdict?: string;
  /** Comma-separated slugs — show this exact set (powers "expose" insight links). */
  slugs?: string;
  page?: number;
  limit?: number;
};

export async function getCachedCatalogSearch(
  params: CatalogSearchParams,
): Promise<CatalogSearchResult> {
  const goal = goalFromParam(params.goal ?? undefined);
  const diet = dietFromParam(params.diet ?? undefined);
  const minRaw = params.min;
  const maxRaw = params.maxprice;
  const page = params.page ?? 1;
  const limit = params.limit ?? 96;

  const cacheKey = JSON.stringify({
    q: params.q ?? "",
    category: params.category ?? "",
    subcategory: params.subcategory ?? "",
    usecase: params.usecase ?? "",
    brand: params.brand ?? "",
    scored: params.scored ?? "",
    labelResolved: params.labelResolved ?? "",
    deepseek: params.deepseek ?? "",
    min: minRaw ?? "",
    maxprice: maxRaw ?? "",
    grade: params.grade ?? "",
    sort: params.sort ?? "",
    goal,
    diet,
    sublabel: params.sublabel ?? "",
    verdict: params.verdict ?? "",
    slugs: params.slugs ?? "",
    page,
    limit,
  });

  return unstable_cache(
    async () => {
      const result = await searchCatalogGrid({
        q: params.q,
        category: params.category,
        subcategory: params.subcategory,
        usecase: params.usecase,
        brand: params.brand,
        page,
        limit,
        onlyScored: params.scored === "1",
        onlyLabelResolved: params.labelResolved === "1",
        onlyDeepseek: params.deepseek === "1",
        minScore: minRaw ? Number(minRaw) : 0,
        maxPrice: maxRaw ? Number(maxRaw) : 0,
        grade: parseGrade(params.grade),
        sort: sortFromParam(params.sort ?? undefined),
        goal,
        diet,
        sublabel: params.sublabel,
        verdict: params.verdict,
        slugs: params.slugs ? params.slugs.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
      // One card per product: other pack sizes are attached, not repeated.
      return { ...result, items: await collapseVariants(result.items) };
    },
      ["catalog-search", "v2", cacheKey],
      { revalidate: 600, tags: ["catalog-search"] },
  )();
}
