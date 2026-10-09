import type { DietMode } from "@/lib/diet/types";
import { computeGoalFit, goalFitInputs } from "@/lib/goals/fit";
import type { GoalId } from "@/lib/goals/types";
import {
  computeCatalogVisible,
  isCatalogSourceRow,
  isCatalogVisible,
} from "@/lib/products/catalog-eligibility";
import {
  filterCatalogProducts,
  hasActiveCatalogFilters,
  type CatalogFilterState,
} from "@/lib/products/catalog-filter";
import {
  FRUITS_VEGETABLES_AISLE,
  productMatchesUsecase,
  productUsecase,
} from "@/lib/products/catalog-meta";
import { catalogSearchIlikeTerm } from "@/lib/products/catalog-query-text";
import {
  compareCatalogItems,
  sortCatalogItems,
  sortFromParam,
  type CatalogSort,
} from "@/lib/products/catalog-sort";
import { adminClient } from "@/lib/supabase/admin";
import { requireSupabaseClient } from "@/lib/supabase/client";
import type { CoreScore, Grade, Product, ProductNutrition, ScoreBand } from "@/lib/supabase/types";
import { deepseekDisplayFromPayload } from "@/lib/ocr/deepseek-promote";
import { normalizeProductImageUrls } from "@/lib/products/catalog-hero-image";

export { isCatalogSourceRow } from "@/lib/products/catalog-eligibility";

/** Server-side reads: service role when set, else anon (browser-safe) client. */
function db() {
  try {
    return adminClient();
  } catch {
    return requireSupabaseClient();
  }
}

/** Cached probe — prod may not have migration 0006 applied yet. */
let catalogVisibleColumn: boolean | undefined;

let cachedEligibleTotal: { count: number; at: number } | null = null;
const ELIGIBLE_COUNT_TTL_MS = 5 * 60 * 1000;

async function countEligibleCatalogProducts(
  state: CatalogFilterState,
  diet: DietMode,
): Promise<number> {
  if (
    cachedEligibleTotal &&
    Date.now() - cachedEligibleTotal.at < ELIGIBLE_COUNT_TTL_MS &&
    !state.q.trim() &&
    !state.category &&
    !state.subcategory &&
    !state.usecase &&
    !state.brand &&
    !state.onlyDeepseek &&
    !state.minScore &&
    !state.grade &&
    !state.maxPrice &&
    diet === "any"
  ) {
    return cachedEligibleTotal.count;
  }

  const supabase = db();
  const sqlVisible = await catalogHasVisibleColumn();
  const batchSize = 1000;
  let dbOffset = 0;
  let total = 0;

  for (;;) {
    let q = applyScoreSortFilters(
      buildCatalogDbQuery(supabase, state, "full", sqlVisible),
      state,
    );
    const { data, error } = await q.range(dbOffset, dbOffset + batchSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (!rows.length) break;
    const batch = sqlVisible ? rows.map(mapListRow) : mapVisibleBatch(rows);
    total += filterCatalogProducts(batch, state, diet).length;
    if (rows.length < batchSize) break;
    dbOffset += rows.length;
    if (dbOffset >= 25_000) break;
  }

  if (
    !state.q.trim() &&
    !state.category &&
    !state.subcategory &&
    !state.usecase &&
    !state.brand &&
    !state.onlyDeepseek &&
    !state.minScore &&
    !state.grade &&
    !state.maxPrice &&
    diet === "any"
  ) {
    cachedEligibleTotal = { count: total, at: Date.now() };
  }

  return total;
}

async function catalogHasVisibleColumn(): Promise<boolean> {
  if (catalogVisibleColumn !== undefined) return catalogVisibleColumn;
  const supabase = db();
  const { error } = await supabase.from("products").select("catalog_visible").limit(0);
  catalogVisibleColumn = !error;
  return catalogVisibleColumn;
}

const LIST_FIELDS =
  "id, slug, name, brand, super_category, category, subcategory, l3_category, net_weight, attributes, price_inr, mrp_inr, image_urls, ocr_image_url, nutrition, ingredients_raw, zepto_sku, platform";

/** Grid list — omits heavy nutrition/ingredients when diet + goal fit are unused. */
const GRID_LIST_FIELDS =
  "id, slug, name, brand, super_category, category, subcategory, net_weight, price_inr, mrp_inr, image_urls, ocr_image_url, zepto_sku, platform";

const GOAL_LIST_FIELDS =
  "id, slug, name, brand, super_category, category, subcategory, l3_category, net_weight, attributes, price_inr, mrp_inr, image_urls, ocr_image_url, nutrition, ingredients_raw, zepto_sku, platform";

/** Insights / landing — no gallery blobs; capped row count at query time. */
const INSIGHTS_LIST_FIELDS =
  "id, slug, name, brand, category, subcategory, l3_category, net_weight, attributes, price_inr, image_urls, nutrition, ingredients_raw, platform, zepto_sku, catalog_visible";

/** Max rows loaded for landing + insights aggregation (avoids build-time DB timeouts). */
export const INSIGHTS_CATALOG_SAMPLE_LIMIT = 6_000;

const LABEL_FILTER_EXTRA = "";

/** Drop multi-KB attribute blobs from catalog JSON (Vercel cache limit is 2MB). */
const CATALOG_ATTR_KEYS = [
  "Diet Preference",
  "Food Preference",
  "Diet",
  "Type",
  "Key Features",
] as const;

function slimAttributesForCatalog(
  attrs: Record<string, string> | null,
): Record<string, string> | null {
  if (!attrs) return null;
  const out: Record<string, string> = {};
  for (const key of CATALOG_ATTR_KEYS) {
    const v = attrs[key];
    if (v?.trim()) out[key] = v.trim().slice(0, 240);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function slimNutritionForCatalog(n: ProductNutrition | null): ProductNutrition | null {
  if (!n) return null;
  const slim: ProductNutrition = { source: n.source };
  if (n.energy_kcal_100g != null) slim.energy_kcal_100g = n.energy_kcal_100g;
  if (n.protein_g_100g != null) slim.protein_g_100g = n.protein_g_100g;
  if (n.carbs_g_100g != null) slim.carbs_g_100g = n.carbs_g_100g;
  if (n.fiber_g_100g != null) slim.fiber_g_100g = n.fiber_g_100g;
  if (n.sugar_g_100g != null) slim.sugar_g_100g = n.sugar_g_100g;
  if (n.added_sugar_g_100g != null) slim.added_sugar_g_100g = n.added_sugar_g_100g;
  if (n.fat_g_100g != null) slim.fat_g_100g = n.fat_g_100g;
  if (n.saturated_fat_g_100g != null) slim.saturated_fat_g_100g = n.saturated_fat_g_100g;
  if (n.sodium_mg_100g != null) slim.sodium_mg_100g = n.sodium_mg_100g;
  return slim;
}

function slimListItemForCatalog(row: ProductListItem): ProductListItem {
  return {
    ...row,
    attributes: slimAttributesForCatalog(row.attributes),
    ingredients_raw: row.ingredients_raw
      ? row.ingredients_raw.slice(0, 600)
      : null,
    nutrition: slimNutritionForCatalog(row.nutrition),
    image_urls: row.image_urls?.length ? [row.image_urls[0]] : [],
  };
}

/** Lighter join for grids — omits heavy subscores/concerns JSON. */
const LIST_SCORE_FIELDS =
  "score, grade, band, verdict, verdict_sublabels, relative_score, cohort_size, absolute_score, category_rank, category_size, category_label";

/** PDP join — includes V9 verdict + cohort fields for chips and percentile line. */
const DETAIL_SCORE_FIELDS = `${LIST_SCORE_FIELDS}, absolute_score, role_cohort, serving_g_effective, cohort_id, opinion`;

export type ProductListItem = Pick<
  Product,
  | "id"
  | "slug"
  | "name"
  | "brand"
  | "super_category"
  | "category"
  | "subcategory"
  | "l3_category"
  | "net_weight"
  | "attributes"
  | "price_inr"
  | "mrp_inr"
  | "image_urls"
  | "nutrition"
  | "ingredients_raw"
> & {
  core_scores: Pick<
    CoreScore,
    | "score"
    | "grade"
    | "band"
    | "verdict"
    | "verdict_sublabels"
    | "relative_score"
    | "cohort_size"
    | "subscores"
    | "concerns"
    | "computed_at"
    | "absolute_score"
    | "category_rank"
    | "category_size"
    | "category_label"
  > | null;
  /** Present when catalog filters need label-resolution metadata. */
  ocr_payload?: Record<string, unknown> | null;
  deepseek_chips?: string[];
  deepseek_why?: string | null;
  ai_match_score?: number;
  ai_health_score?: number;
  ai_match_reasons?: string[];
  ai_match_warning?: string | null;
};

export type ProductDetail = Product & {
  core_scores: CoreScore | null;
  platform?: string | null;
  data_source?: string | null;
  ocr_status?: string | null;
  ocr_payload?: Record<string, unknown> | null;
  ocr_image_url?: string | null;
};

export type CatalogFilters = {
  categories: string[];
  subcategories: string[];
  usecases: string[];
  brands: string[];
};

export type CatalogGridItem = Pick<
  ProductListItem,
  | "id"
  | "slug"
  | "name"
  | "brand"
  | "category"
  | "subcategory"
  | "net_weight"
  | "price_inr"
  | "mrp_inr"
  | "image_urls"
> & {
  core_scores: Pick<
    CoreScore,
    | "score"
    | "grade"
    | "band"
    | "verdict"
    | "verdict_sublabels"
    | "relative_score"
    | "cohort_size"
    | "absolute_score"
    | "category_rank"
    | "category_size"
    | "category_label"
  > | null;
  deepseek_chips?: string[];
  deepseek_why?: string | null;
  /** Other pack sizes of the same product (lib/products/variants). */
  sizes?: { slug: string; net_weight: string | null; price_inr: number | null }[];
};

export type CatalogSearchResult = {
  items: CatalogGridItem[];
  goalFits: Record<string, number>;
  page: number;
  limit: number;
  /** Products matching current filters (scored pool when unfiltered). */
  total: number;
  hasMore: boolean;
};

export type CatalogMeta = {
  stats: { visible: number; scored: number; zepto: number };
  filters: CatalogFilters;
};

function toGridItem(row: ProductListItem): CatalogGridItem {
  const deepseek = deepseekDisplayFromPayload(row.ocr_payload);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category,
    subcategory: row.subcategory,
    net_weight: row.net_weight,
    price_inr: row.price_inr,
    mrp_inr: row.mrp_inr,
    image_urls: row.image_urls?.length ? [row.image_urls[0]] : [],
    core_scores: row.core_scores
      ? {
          score: row.core_scores.absolute_score ?? row.core_scores.score,
          grade: row.core_scores.grade,
          band: row.core_scores.band,
          verdict: row.core_scores.verdict ?? null,
          verdict_sublabels: row.core_scores.verdict_sublabels ?? [],
          relative_score: row.core_scores.relative_score ?? null,
          cohort_size: row.core_scores.cohort_size ?? null,
          absolute_score: row.core_scores.absolute_score ?? null,
          category_rank: row.core_scores.category_rank ?? null,
          category_size: row.core_scores.category_size ?? null,
          category_label: row.core_scores.category_label ?? null,
        }
      : null,
    deepseek_chips: deepseek?.chipLabels ?? [],
    deepseek_why: deepseek?.why ?? null,
  };
}

function rowIsCatalogEligible(row: Record<string, unknown>): boolean {
  if (row.catalog_visible === true) return true;
  if (row.catalog_visible === false) return false;
  const mapped = mapListRow(row);
  return computeCatalogVisible({
    platform: row.platform as string,
    zepto_sku: row.zepto_sku as string | null,
    name: mapped.name,
    super_category: mapped.super_category,
    category: mapped.category,
    subcategory: mapped.subcategory,
    ingredients_raw: mapped.ingredients_raw,
    nutrition: mapped.nutrition,
  });
}

function mapVisibleBatch(rows: Record<string, unknown>[]): ProductListItem[] {
  return rows.filter(rowIsCatalogEligible).map((row) => mapListRow(row));
}

function mapListRow(row: Record<string, unknown>): ProductListItem {
  const scores = row.core_scores;
  const core =
    scores && typeof scores === "object" && !Array.isArray(scores)
      ? (scores as ProductListItem["core_scores"])
      : Array.isArray(scores) && scores[0]
        ? (scores[0] as ProductListItem["core_scores"])
        : null;
  // One displayed score everywhere: the absolute health score the PDP and verdicts use.
  if (core && core.absolute_score != null) core.score = core.absolute_score;

  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    super_category: (row.super_category as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    subcategory: (row.subcategory as string | null) ?? null,
    l3_category:
      (row.l3_category as string | null) ??
      ((row.attributes as Record<string, string> | null)?.["L3 Category"] ?? null),
    net_weight: (row.net_weight as string | null) ?? null,
    attributes: (row.attributes as Record<string, string> | null) ?? null,
    price_inr: row.price_inr != null ? Number(row.price_inr) : null,
    mrp_inr: row.mrp_inr != null ? Number(row.mrp_inr) : null,
    image_urls: normalizeProductImageUrls((row.image_urls as string[]) ?? [], {
      ocrImageUrl: (row.ocr_image_url as string | null) ?? null,
      ocrPayload: (row.ocr_payload as Record<string, unknown> | null) ?? null,
    }),
    nutrition: (row.nutrition as ProductNutrition | null) ?? null,
    ingredients_raw: (row.ingredients_raw as string | null) ?? null,
    ocr_payload: (row.ocr_payload as Record<string, unknown> | null) ?? null,
    core_scores: core,
  };
}

function catalogListFields(
  variant: "grid" | "goal" | "full",
  state: CatalogFilterState,
): string {
  const base =
    variant === "goal" ? GOAL_LIST_FIELDS : variant === "full" ? LIST_FIELDS : GRID_LIST_FIELDS;
  if ((state.onlyLabelResolved || state.onlyDeepseek) && !base.includes("ocr_payload")) {
    return `${base}${LABEL_FILTER_EXTRA}`;
  }
  return base;
}

/** PostgREST filter: LM pipeline updated nutrition and/or ingredients. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLabelResolvedDbFilter(q: any): any {
  return q; // ocr_payload column dropped — label comparison now in-memory only
}

type CatalogFilterRpc = {
  categories: string[];
  subcategories: string[];
  usecases: string[];
  brands: string[];
};

function mergePinnedCategories(filters: CatalogFilters): CatalogFilters {
  // F&V removed — Zepto's "Fruits & Vegetables" aisle has only 1 actual product;
  // packaged dry fruits / nuts come through other aisles. Re-add when fresh
  // produce data lands on the platform.
  const categories = [...filters.categories].sort((a, b) => a.localeCompare(b));
  return { ...filters, categories };
}

type CatalogStatsRpc = {
  visible: number;
  scored: number;
  zepto: number;
};

async function fetchCatalogFilterOptions(category?: string): Promise<CatalogFilters> {
  const supabase = db();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("get_catalog_filter_options", {
    p_category: category ?? null,
  });
  if (error) {
    return getCatalogFiltersFallback(category);
  }
  const row = data as CatalogFilterRpc | null;
  return mergePinnedCategories({
    categories: row?.categories ?? [],
    subcategories: row?.subcategories ?? [],
    usecases: row?.usecases ?? [],
    brands: row?.brands ?? [],
  });
}

async function fetchCatalogStats(): Promise<CatalogStatsRpc> {
  const supabase = db();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("get_catalog_stats");
  if (error) {
    return countVisibleCatalogFallback();
  }
  const row = data as CatalogStatsRpc | null;
  return {
    visible: row?.visible ?? 0,
    scored: row?.scored ?? 0,
    zepto: row?.zepto ?? 0,
  };
}

/** Fallback when RPC migration is not applied yet. */
async function getCatalogFiltersFallback(category?: string): Promise<CatalogFilters> {
  const supabase = db();
  const pageSize = 2000;
  const all: Record<string, unknown>[] = [];

  for (let offset = 0; offset < 25_000; offset += pageSize) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("products")
      .select("category, subcategory, brand, attributes, l3_category")
      .eq("platform", "zepto")
      .not("category", "is", null)
      .range(offset, offset + pageSize - 1);

    if (category) {
      q = applyCategoryFilter(q, { category } as CatalogFilterState);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  const categories = new Set<string>();
  const subcategories = new Set<string>();
  const usecases = new Set<string>();
  const brands = new Set<string>();

  for (const row of all) {
    const cat = row.category as string | null;
    const sub = row.subcategory as string | null;
    const brand = row.brand as string | null;
    const attrs = row.attributes as Record<string, string> | null;
    if (cat) categories.add(cat);
    if (!category || cat === category) {
      if (sub) subcategories.add(sub);
      const l3 =
        (row.l3_category as string | null) ??
        attrs?.["L3 Category"];
      if (l3?.trim()) usecases.add(l3.trim());
      if (brand) brands.add(brand);
    }
  }

  const sort = (a: string, b: string) => a.localeCompare(b);
  return mergePinnedCategories({
    categories: [...categories].sort(sort),
    subcategories: [...subcategories].sort(sort),
    usecases: [...usecases].sort(sort),
    brands: [...brands].sort(sort),
  });
}

async function countVisibleCatalogFallback(): Promise<CatalogStatsRpc> {
  const supabase = db();

  const [zeptoRes, scoredRes, visibleRes] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("platform", "zepto"),
    supabase.from("core_scores").select("product_id", { count: "exact", head: true }),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("platform", "zepto")
      .not("nutrition", "is", null)
      .not("ingredients_raw", "is", null),
  ]);

  return {
    visible: visibleRes.count ?? 0,
    scored: scoredRes.count ?? 0,
    zepto: zeptoRes.count ?? 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyDbSort(q: any, sort: CatalogSort): any {
  switch (sort) {
    case "score-asc":
      return q.order("absolute_score", {
        referencedTable: "core_scores",
        ascending: true,
        nullsFirst: false,
      });
    case "price-asc":
      return q.order("price_inr", { ascending: true, nullsFirst: false });
    case "price-desc":
      return q.order("price_inr", { ascending: false, nullsFirst: false });
    case "newest-desc":
      return q.order("updated_at", { ascending: false, nullsFirst: false });
    case "name-asc":
      return q.order("name", { ascending: true });
    case "protein-desc":
    case "score-desc":
    default:
      return q.order("absolute_score", {
        referencedTable: "core_scores",
        ascending: false,
        nullsFirst: false,
      });
  }
}

export async function getCatalogFilters(category?: string): Promise<CatalogFilters> {
  return fetchCatalogFilterOptions(category);
}

export async function countVisibleCatalog(): Promise<{
  visible: number;
  scored: number;
  zepto: number;
}> {
  return fetchCatalogStats();
}

export async function getCatalogMeta(category?: string): Promise<CatalogMeta> {
  const [stats, filters] = await Promise.all([
    countVisibleCatalog(),
    getCatalogFilters(category),
  ]);
  return { stats, filters };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCategoryFilter(q: any, state: CatalogFilterState, productsPrefix?: string): any {
  if (!state.category) return q;
  if (state.category === FRUITS_VEGETABLES_AISLE) {
    const col = productsPrefix ? `${productsPrefix}.category` : "category";
    const nut = productsPrefix ? `${productsPrefix}.nutrition` : "nutrition";
    // CSV category_name + reference-seeded produce (legacy rows).
    return q.or(
      `${col}.eq.${FRUITS_VEGETABLES_AISLE},${nut}->extra->>reference_id.not.is.null`,
    );
  }
  const col = productsPrefix ? `${productsPrefix}.category` : "category";
  return q.eq(col, state.category);
}

function buildCatalogDbQuery(
  supabase: ReturnType<typeof db>,
  state: CatalogFilterState,
  variant: "grid" | "goal" | "full" = "grid",
  sqlVisible = true,
) {
  const fields = catalogListFields(variant, state);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("products")
    .select(`${fields}, core_scores (${LIST_SCORE_FIELDS})`)
    .eq("platform", "zepto");
  if (sqlVisible) q = q.eq("catalog_visible", true);

  if (state.onlyLabelResolved) q = applyLabelResolvedDbFilter(q);
  // Push deepseek filter to SQL — checks ocr_payload->deepseek_label exists in DB
  if (state.onlyDeepseek) q = q.not("ocr_payload->deepseek_label", "is", null);
  if (state.onlyScored) q = q.not("core_scores", "is", null);
  if (state.minScore > 0) q = q.gte("core_scores.score", state.minScore);
  if (state.grade) q = q.eq("core_scores.grade", state.grade);
  if (state.verdict) q = q.eq("core_scores.verdict", state.verdict);
  if (state.sublabel) q = q.filter("core_scores.verdict_sublabels", "cs", `{"${state.sublabel}"}`);
  if (state.brand) q = q.eq("brand", state.brand);
  q = applyCategoryFilter(q, state);
  if (state.subcategory) q = q.eq("subcategory", state.subcategory);
  if (state.usecase) {
    q = q.filter("attributes->>L3 Category", "eq", state.usecase);
  }
  if (state.maxPrice > 0) {
    q = q.lte("price_inr", state.maxPrice);
  }
  const searchTerm = catalogSearchIlikeTerm(state.q);
  if (searchTerm) {
    q = q.or(`name.ilike.%${searchTerm}%,brand.ilike.%${searchTerm}%,subcategory.ilike.%${searchTerm}%`);
  }
  return q;
}

function applyScoreSortFilters(
  q: ReturnType<typeof buildCatalogDbQuery>,
  state: CatalogFilterState,
) {
  if (state.sort === "score-desc" || state.sort === "score-asc") {
    return q.not("core_scores", "is", null);
  }
  return q;
}

function needsMemorySort(sort: CatalogSort): boolean {
  return sort === "protein-desc";
}

function isScoreSort(sort: CatalogSort): boolean {
  return sort === "score-desc" || sort === "score-asc";
}

function mapScoreSortedRow(row: Record<string, unknown>): ProductListItem {
  const raw = row.products;
  const p =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : Array.isArray(raw) && raw[0]
        ? (raw[0] as Record<string, unknown>)
        : null;
  if (!p) {
    throw new Error("mapScoreSortedRow: missing products embed");
  }
  return {
    id: p.id as string,
    slug: p.slug as string,
    name: p.name as string,
    brand: (p.brand as string | null) ?? null,
    super_category: (p.super_category as string | null) ?? null,
    category: (p.category as string | null) ?? null,
    subcategory: (p.subcategory as string | null) ?? null,
    l3_category: (p.l3_category as string | null) ?? null,
    net_weight: (p.net_weight as string | null) ?? null,
    attributes: null,
    price_inr: p.price_inr != null ? Number(p.price_inr) : null,
    mrp_inr: p.mrp_inr != null ? Number(p.mrp_inr) : null,
    image_urls: (p.image_urls as string[]) ?? [],
    nutrition: null,
    ingredients_raw: null,
    core_scores: {
      score: ((row.absolute_score as number | null) ?? row.score) as number,
      grade: row.grade as Grade,
      band: row.band as ScoreBand,
      verdict: (row.verdict as string | null) ?? null,
      verdict_sublabels: (row.verdict_sublabels as string[] | null) ?? [],
      relative_score: (row.relative_score as number | null) ?? null,
      cohort_size: (row.cohort_size as number | null) ?? null,
      absolute_score: (row.absolute_score as number | null) ?? null,
      category_rank: (row.category_rank as number | null) ?? null,
      category_size: (row.category_size as number | null) ?? null,
      category_label: (row.category_label as string | null) ?? null,
    },
  } as ProductListItem;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyScoreCatalogFilters(q: any, state: CatalogFilterState): any {
  if (state.grade) q = q.eq("grade", state.grade);
  if (state.minScore > 0) q = q.gte("absolute_score", state.minScore);
  if (state.verdict) q = q.eq("verdict", state.verdict);
  // JSONB array containment: verdict_sublabels @> '["sublabel"]'::jsonb
  if (state.sublabel) q = q.filter("verdict_sublabels", "cs", `{"${state.sublabel}"}`);
  if (state.brand) q = q.eq("products.brand", state.brand);
  q = applyCategoryFilter(q, state, "products");
  if (state.subcategory) q = q.eq("products.subcategory", state.subcategory);
  if (state.usecase) {
    q = q.filter("products.attributes->>L3 Category", "eq", state.usecase);
  }
  if (state.maxPrice > 0) q = q.lte("products.price_inr", state.maxPrice);
  const searchTerm = catalogSearchIlikeTerm(state.q);
  if (searchTerm) {
    q = q.or(
      `name.ilike.%${searchTerm}%,brand.ilike.%${searchTerm}%,subcategory.ilike.%${searchTerm}%`,
      { referencedTable: "products" },
    );
  }
  return q;
}

function buildScoreSortedCatalogQuery(
  supabase: ReturnType<typeof db>,
  state: CatalogFilterState,
  ascending: boolean,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("core_scores")
    .select(`score, absolute_score, category_rank, category_size, category_label, grade, band, verdict, verdict_sublabels, relative_score, cohort_size, products!inner(${GRID_LIST_FIELDS}, catalog_visible)`)
    .eq("products.platform", "zepto")
    .eq("products.catalog_visible", true);
  q = applyScoreCatalogFilters(q, state);
  return q.order("absolute_score", { ascending, nullsFirst: false });
}

async function countScoreSortedCatalogMatches(
  supabase: ReturnType<typeof db>,
  state: CatalogFilterState,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("core_scores")
    .select("score, products!inner(id)", { count: "exact", head: true })
    .eq("products.platform", "zepto")
    .eq("products.catalog_visible", true);
  q = applyScoreCatalogFilters(q, state);
  const { count, error } = await q;
  if (error) throw new Error(error.message || "countScoreSortedCatalogMatches failed");
  return count ?? 0;
}

async function paginateCatalogByScoreSql(opts: {
  page: number;
  limit: number;
  state: CatalogFilterState;
}): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const { page, limit, state } = opts;
  const ascending = state.sort === "score-asc";
  const start = (page - 1) * limit;
  const supabase = db();
  const q = buildScoreSortedCatalogQuery(supabase, state, ascending);

  const [{ data, error }, total] = await Promise.all([
    q.range(start, start + limit - 1),
    hasActiveCatalogFilters(state)
      ? countScoreSortedCatalogMatches(supabase, state)
      : fetchCatalogStats().then((s) => s.scored),
  ]);

  if (error) throw new Error(error.message);
  const items = ((data ?? []) as Record<string, unknown>[]).map(mapScoreSortedRow);

  return {
    items,
    total,
    hasMore: start + items.length < total,
  };
}

function countNeedsScoreJoin(state: CatalogFilterState): boolean {
  return (
    state.onlyScored ||
    state.minScore > 0 ||
    Boolean(state.grade) ||
    Boolean(state.verdict) ||
    Boolean(state.sublabel) ||
    state.sort === "score-desc" ||
    state.sort === "score-asc"
  );
}

async function countCatalogMatches(
  supabase: ReturnType<typeof db>,
  state: CatalogFilterState,
  sqlVisible = true,
): Promise<number> {
  const scoreJoin = countNeedsScoreJoin(state);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("products")
    .select(scoreJoin ? "id, core_scores!inner(score)" : "id", {
      count: "exact",
      head: true,
    })
    .eq("platform", "zepto");
  if (sqlVisible) q = q.eq("catalog_visible", true);

  if (state.onlyLabelResolved) q = applyLabelResolvedDbFilter(q);
  if (!scoreJoin && state.onlyScored) q = q.not("core_scores", "is", null);
  if (state.minScore > 0) q = q.gte("core_scores.score", state.minScore);
  if (state.grade) q = q.eq("core_scores.grade", state.grade);
  if (state.verdict) q = q.eq("core_scores.verdict", state.verdict);
  if (state.sublabel) q = q.filter("core_scores.verdict_sublabels", "cs", `{"${state.sublabel}"}`);
  if (state.brand) q = q.eq("brand", state.brand);
  q = applyCategoryFilter(q, state);
  if (state.subcategory) q = q.eq("subcategory", state.subcategory);
  if (state.usecase) {
    q = q.filter("attributes->>L3 Category", "eq", state.usecase);
  }
  if (state.maxPrice > 0) q = q.lte("price_inr", state.maxPrice);
  const searchTerm = catalogSearchIlikeTerm(state.q);
  if (searchTerm) {
    q = q.or(`name.ilike.%${searchTerm}%,brand.ilike.%${searchTerm}%,subcategory.ilike.%${searchTerm}%`);
  }
  if (!scoreJoin && (state.sort === "score-desc" || state.sort === "score-asc")) {
    q = q.not("core_scores", "is", null);
  }

  const { count, error } = await q;
  if (error) throw new Error(error.message || "countCatalogMatches failed");
  return count ?? 0;
}

async function paginateCatalogSql(opts: {
  page: number;
  limit: number;
  state: CatalogFilterState;
  diet: DietMode;
  variant?: "grid" | "goal" | "full";
}): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const { page, limit, state, diet, variant = "grid" } = opts;
  const sqlVisible = await catalogHasVisibleColumn();

  // onlyDeepseek is now pushed to SQL via buildCatalogDbQuery — no longer needs client loop.
  // Only fall back to client-side pagination when diet filtering is needed (requires ingredients_raw).
  if (diet !== "any" || !sqlVisible || state.onlyLabelResolved) {
    return paginateCatalogWithClientFilter({
      page,
      limit,
      state,
      diet,
      variant: sqlVisible ? (state.onlyLabelResolved ? "full" : variant) : "full",
    });
  }

  if (isScoreSort(state.sort)) {
    return paginateCatalogByScoreSql({ page, limit, state });
  }

  const start = (page - 1) * limit;
  const supabase = db();
  let q = applyScoreSortFilters(buildCatalogDbQuery(supabase, state, variant, true), state);
  q = applyDbSort(q, state.sort);

  const [{ data, error }, total] = await Promise.all([
    q.range(start, start + limit - 1),
    hasActiveCatalogFilters(state, diet)
      ? countCatalogMatches(supabase, state, true)
      : fetchCatalogStats().then((s) => s.visible),
  ]);

  if (error) throw new Error(error.message);
  const items = ((data ?? []) as unknown as Record<string, unknown>[]).map(mapListRow);

  return {
    items,
    total,
    hasMore: start + items.length < total,
  };
}

async function paginateCatalogWithClientFilter(opts: {
  page: number;
  limit: number;
  state: CatalogFilterState;
  diet: DietMode;
  variant?: "grid" | "goal" | "full";
}): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const { page, limit, state, diet, variant = "full" } = opts;
  const start = (page - 1) * limit;
  const target = start + limit;
  const supabase = db();
  const batchSize = 2000;
  const matched: ProductListItem[] = [];
  let dbOffset = 0;
  let dbExhausted = false;
  const sqlVisible = await catalogHasVisibleColumn();

  while (matched.length < target && !dbExhausted && dbOffset < 25_000) {
    let q = applyScoreSortFilters(
      buildCatalogDbQuery(supabase, state, variant, sqlVisible),
      state,
    );
    q = applyDbSort(q, state.sort);
    const { data, error } = await q.range(dbOffset, dbOffset + batchSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (rows.length < batchSize) dbExhausted = true;
    dbOffset += rows.length;

    const batch = sqlVisible ? rows.map(mapListRow) : mapVisibleBatch(rows);
    matched.push(...filterCatalogProducts(batch, state, diet));
  }

  const sorted = sortCatalogItems(matched, state.sort);
  const items = sorted.slice(start, start + limit);
  const total = dbExhausted
    ? sorted.length
    : page === 1
      ? await countEligibleCatalogProducts(state, diet)
      : (cachedEligibleTotal?.count ?? Math.max(sorted.length, start + limit));

  return {
    items,
    total,
    hasMore: dbExhausted ? start + limit < sorted.length : items.length === limit,
  };
}

async function paginateGoalCatalog(opts: {
  page: number;
  limit: number;
  state: CatalogFilterState;
  diet: DietMode;
  goal: GoalId;
}): Promise<CatalogSearchResult> {
  const { page, limit, state, diet, goal } = opts;
  const supabase = db();
  const poolSize = 2000;
  const pageSize = 1000;
  const pool: ProductListItem[] = [];
  const sqlVisible = await catalogHasVisibleColumn();

  for (let offset = 0; offset < poolSize; offset += pageSize) {
    let q = applyScoreSortFilters(
      buildCatalogDbQuery(supabase, state, "goal", sqlVisible),
      state,
    );
    q = applyDbSort(q, "score-desc").not("core_scores", "is", null);
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const batch = sqlVisible ? rows.map(mapListRow) : mapVisibleBatch(rows);
    pool.push(...filterCatalogProducts(batch, state, diet));
    if (rows.length < pageSize) break;
  }

  const ranked = pool
    .map((p) => ({ p, fit: computeGoalFit(goal, goalFitInputs(p)).fit }))
    .sort((a, b) => {
      const fitDiff = b.fit - a.fit;
      if (fitDiff !== 0) return fitDiff;
      return compareCatalogItems(a.p, b.p, state.sort);
    });
  const goalFits = Object.fromEntries(ranked.map(({ p, fit }) => [p.id, fit]));
  const sorted = ranked.map((x) => x.p);
  const total = sorted.length;
  const start = (page - 1) * limit;
  const items = sorted.slice(start, start + limit).map(toGridItem);

  return {
    items,
    goalFits: Object.fromEntries(items.map((i) => [i.id, goalFits[i.id] ?? 0])),
    page,
    limit,
    total,
    hasMore: start + limit < total,
  };
}

async function fetchProteinSortedCatalog(
  state: CatalogFilterState,
  diet: DietMode,
  maxRows = 2000,
): Promise<ProductListItem[]> {
  const supabase = db();
  const pageSize = 1000;
  const all: ProductListItem[] = [];
  const sqlVisible = await catalogHasVisibleColumn();

  // Only fetch scored products with nutrition data — they're the only ones that can rank by protein
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let q = buildCatalogDbQuery(supabase, state, "full", sqlVisible);
    q = q.not("core_scores", "is", null).not("nutrition", "is", null);
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const batch = sqlVisible ? rows.map(mapListRow) : mapVisibleBatch(rows);
    all.push(...filterCatalogProducts(batch, state, diet));
    if (rows.length < pageSize) break;
  }

  return sortCatalogItems(all, state.sort);
}

function parseSearchState(opts: {
  q?: string;
  category?: string;
  subcategory?: string;
  usecase?: string;
  brand?: string;
  onlyScored?: boolean;
  onlyLabelResolved?: boolean;
  onlyDeepseek?: boolean;
  minScore?: number;
  maxPrice?: number;
  grade?: Grade | "";
  sort?: CatalogSort;
  sublabel?: string;
  verdict?: string;
}): CatalogFilterState {
  return {
    q: opts.q?.trim() ?? "",
    category: opts.category ?? "",
    subcategory: opts.subcategory ?? "",
    usecase: opts.usecase ?? "",
    brand: opts.brand ?? "",
    onlyScored: opts.onlyScored ?? false,
    onlyLabelResolved: opts.onlyLabelResolved ?? false,
    onlyDeepseek: opts.onlyDeepseek ?? false,
    minScore: opts.minScore ?? 0,
    maxPrice: opts.maxPrice ?? 0,
    grade: opts.grade ?? "",
    sort: opts.sort ?? "score-desc",
    sublabel: opts.sublabel ?? "",
    verdict: opts.verdict ?? "",
  };
}

export async function searchCatalogGrid(opts: {
  q?: string;
  category?: string;
  subcategory?: string;
  usecase?: string;
  brand?: string;
  page?: number;
  limit?: number;
  onlyScored?: boolean;
  onlyLabelResolved?: boolean;
  onlyDeepseek?: boolean;
  minScore?: number;
  maxPrice?: number;
  grade?: Grade | "";
  sort?: CatalogSort;
  goal?: GoalId;
  diet?: DietMode;
  sublabel?: string;
  verdict?: string;
  slugs?: string[];
}): Promise<CatalogSearchResult> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(120, Math.max(1, opts.limit ?? 96));
  const goal = opts.goal ?? "balanced";
  const diet = opts.diet ?? "any";

  // Exact-set view — powers "expose" insight links (e.g. the homepage "53%"
  // stat → the specific products behind it). Bypasses the filter/sort pipeline.
  if (opts.slugs?.length) {
    const rows = await getProductsBySlugs(opts.slugs);
    const items = rows.map(toGridItem);
    return { items, goalFits: {}, page: 1, limit: items.length, total: items.length, hasMore: false };
  }

  const state = parseSearchState(opts);

  if (goal !== "balanced") {
    return paginateGoalCatalog({ page, limit, state, diet, goal });
  }

  if (needsMemorySort(state.sort)) {
    const pool = await fetchProteinSortedCatalog(state, diet);
    const total = pool.length;
    const start = (page - 1) * limit;
    const items = pool.slice(start, start + limit).map(toGridItem);
    return {
      items,
      goalFits: {},
      page,
      limit,
      total,
      hasMore: start + limit < total,
    };
  }

  const paged = await paginateCatalogSql({ page, limit, state, diet });
  return {
    items: paged.items.map(toGridItem),
    goalFits: {},
    page,
    limit,
    total: paged.total,
    hasMore: paged.hasMore,
  };
}

export type ScoredCatalogStats = {
  totalScored: number;
};

/** Fast head count for landing stats (full catalog, not the insights sample). */
export async function getScoredCatalogStats(): Promise<ScoredCatalogStats> {
  const supabase = db();
  const sqlVisible = await catalogHasVisibleColumn();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("products")
    .select("id, core_scores!inner(product_id)", { count: "exact", head: true })
    .eq("platform", "zepto");
  if (sqlVisible) q = q.eq("catalog_visible", true);

  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return { totalScored: count ?? 0 };
}

export type ScoredVerdictStats = {
  totalScored: number;
  dailyStapleCount: number;
  skipCount: number;
};

/** Count a verdict across the FULL visible scored catalog (not the sample). */
async function countVerdict(verdict: string, sqlVisible: boolean): Promise<number> {
  const supabase = db();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("core_scores")
    .select("product_id, products!inner(id)", { count: "exact", head: true })
    .eq("verdict", verdict)
    .eq("products.platform", "zepto");
  if (sqlVisible) q = q.eq("products.catalog_visible", true);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** True header numbers for insights — exact counts over the whole catalog. */
export async function getScoredVerdictStats(): Promise<ScoredVerdictStats> {
  const sqlVisible = await catalogHasVisibleColumn();
  const [{ totalScored }, dailyStapleCount, skipCount] = await Promise.all([
    getScoredCatalogStats(),
    countVerdict("daily_staple", sqlVisible),
    countVerdict("skip", sqlVisible),
  ]);
  return { totalScored, dailyStapleCount, skipCount };
}

/** PostgREST caps a single response at its max-rows setting (1k on this
 * project), so a bare `.limit(6000)` silently returns the first 1k rows by
 * insertion id — the oldest scrape batch, which badly skews every insight.
 * Page in `range()` windows instead, ordered by slug so the sample mixes
 * brands and categories rather than scrape order. Pages run SEQUENTIALLY —
 * this is a background cache refresh, and six concurrent 1k-row scans can
 * starve the connection pool while batch jobs (scoring, enrichment) run. */
const INSIGHTS_PAGE_SIZE = 1_000;

/** Scored visible products for insights — bounded representative sample, slim fields. */
export async function getScoredProductsForInsights(): Promise<ProductListItem[]> {
  const supabase = db();
  const sqlVisible = await catalogHasVisibleColumn();

  const pageCount = Math.ceil(INSIGHTS_CATALOG_SAMPLE_LIMIT / INSIGHTS_PAGE_SIZE);
  const fetchPage = async (page: number): Promise<Record<string, unknown>[]> => {
    const start = page * INSIGHTS_PAGE_SIZE;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("products")
      .select(`${INSIGHTS_LIST_FIELDS}, core_scores (${LIST_SCORE_FIELDS})`)
      .eq("platform", "zepto")
      .not("core_scores", "is", null)
      .order("slug", { ascending: true })
      .range(start, Math.min(start + INSIGHTS_PAGE_SIZE, INSIGHTS_CATALOG_SAMPLE_LIMIT) - 1);
    if (sqlVisible) q = q.eq("catalog_visible", true);
    const { data, error } = await q;
    // Out-of-range pages 416 once the catalog is exhausted — treat as empty.
    if (error) {
      if (page > 0) return [];
      throw new Error(error.message);
    }
    return (data ?? []) as unknown as Record<string, unknown>[];
  };

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = await fetchPage(i);
    rows.push(...page);
    if (page.length < INSIGHTS_PAGE_SIZE) break; // catalog exhausted
  }
  const mapped = sqlVisible ? rows.map(mapListRow) : mapVisibleBatch(rows);
  return mapped.map(slimListItemForCatalog);
}

export async function searchProducts(opts: {
  q?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  limit?: number;
  onlyScored?: boolean;
  onlyWithDetail?: boolean;
}): Promise<ProductListItem[]> {
  const supabase = db();
  const limit = opts.limit ?? 120;

  let query = supabase
    .from("products")
    .select(`${LIST_FIELDS}, core_scores (${LIST_SCORE_FIELDS})`)
    .order("name", { ascending: true })
    .limit(limit);

  if (opts.onlyWithDetail) {
    query = query.eq("platform", "zepto");
  }

  if (opts.q?.trim()) {
    query = query.ilike("name", `%${opts.q.trim()}%`);
  }
  if (opts.category) query = query.eq("category", opts.category);
  if (opts.subcategory) query = query.eq("subcategory", opts.subcategory);
  if (opts.brand) query = query.eq("brand", opts.brand);

  if (opts.onlyScored) {
    query = query.not("core_scores", "is", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const items = (data ?? [])
    .filter((row) => {
      const r = row as Record<string, unknown>;
      const mapped = mapListRow(r);
      return (
        isCatalogVisible(mapped) &&
        isCatalogSourceRow({
          platform: r.platform as string,
          zepto_sku: r.zepto_sku as string | null,
        })
      );
    })
    .map((row) => mapListRow(row as Record<string, unknown>));
  items.sort((a, b) => (b.core_scores?.score ?? -1) - (a.core_scores?.score ?? -1));
  return items;
}

/** Full catalog for client-side instant filtering (search page). */
export async function getAllCatalogProducts(opts?: {
  onlyWithDetail?: boolean;
  onlyScored?: boolean;
  /** Stop after this many rows (faster AI search pool warm). */
  maxRows?: number;
}): Promise<ProductListItem[]> {
  const supabase = db();
  const pageSize = 1000;
  const max = opts?.maxRows ?? 30_000;
  const all: ProductListItem[] = [];

  const hasVisible = await catalogHasVisibleColumn();
  for (let offset = 0; offset < max; offset += pageSize) {
    let query = supabase
      .from("products")
      .select(`${LIST_FIELDS}, core_scores (${LIST_SCORE_FIELDS})`)
      .order("name", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (opts?.onlyWithDetail ?? true) {
      query = query.eq("platform", "zepto");
    }
    // Apply catalog_visible in SQL — reduces rows fetched from 24K to 9.9K
    if (hasVisible) {
      query = query.eq("catalog_visible", true);
    }
    if (opts?.onlyScored) {
      query = query.not("core_scores", "is", null);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const batch = rows
      .filter((row) => {
        const r = row as Record<string, unknown>;
        const mapped = mapListRow(r);
        return (
          isCatalogVisible(mapped) &&
          isCatalogSourceRow({
            platform: r.platform as string,
            zepto_sku: r.zepto_sku as string | null,
          })
        );
      })
      .map((row) => mapListRow(row as Record<string, unknown>));
    all.push(...batch);
    if (rows.length < pageSize) break;
    if (opts?.maxRows != null && all.length >= opts.maxRows) break;
  }

  all.sort((a, b) => (b.core_scores?.score ?? -1) - (a.core_scores?.score ?? -1));
  const trimmed = opts?.maxRows != null ? all.slice(0, opts.maxRows) : all;
  return trimmed.map(slimListItemForCatalog);
}

/** Cap in-memory scan for AI search — keeps /api/search/ai under serverless time limits. */
export const AI_SEARCH_POOL_LIMIT = 10_000;

// In-process cache for the AI search product pool — expires every 10 minutes.
// Prevents getAllCatalogProducts from hitting Supabase on every search request.
let _aiProductPoolCache: { data: ProductListItem[]; at: number } | null = null;
const AI_POOL_TTL_MS = 10 * 60 * 1000;

export async function getAiSearchProductPool(): Promise<ProductListItem[]> {
  if (_aiProductPoolCache && Date.now() - _aiProductPoolCache.at < AI_POOL_TTL_MS) {
    return _aiProductPoolCache.data;
  }
  // Include ALL catalog-visible products, not just scored ones.
  // Many commodity products (milk, dal, rice) are never scored but are perfectly valid results.
  const data = await getAllCatalogProducts({
    onlyWithDetail: true,
    onlyScored: false,
    maxRows: AI_SEARCH_POOL_LIMIT,
  });
  _aiProductPoolCache = { data, at: Date.now() };
  return data;
}

/** Same L3 use-case pool for PDP swaps and “more in this aisle”. */
export async function getProductsForSwaps(
  current: Pick<
    ProductListItem,
    "id" | "category" | "super_category" | "subcategory" | "l3_category" | "attributes"
  >,
  limit = 200,
): Promise<ProductListItem[]> {
  const usecase = productUsecase(current);
  const supabase = db();
  let query = supabase
    .from("products")
    .select(`${LIST_FIELDS}, core_scores (${LIST_SCORE_FIELDS})`)
    .eq("platform", "zepto")
    .not("core_scores", "is", null)
    .neq("id", current.id)
    .limit(limit);

  if (usecase) {
    query = query.eq("l3_category", usecase);
  } else {
    const aisle = current.category ?? current.super_category;
    if (aisle) query = query.eq("category", aisle);
    if (current.subcategory?.trim()) query = query.eq("subcategory", current.subcategory.trim());
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? [])
    .map((row) => mapListRow(row as Record<string, unknown>))
    .filter(isCatalogVisible);
  if (usecase) {
    return rows.filter((p) => productMatchesUsecase(p, usecase));
  }
  return rows;
}

export async function getProductsBySlugs(slugs: string[]): Promise<ProductListItem[]> {
  if (!slugs.length) return [];
  const supabase = db();
  const { data, error } = await supabase
    .from("products")
    .select(`${LIST_FIELDS}, core_scores (${LIST_SCORE_FIELDS})`)
    .in("slug", slugs);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapListRow(row as Record<string, unknown>));
}

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const supabase = db();

  const { data, error } = await supabase
    .from("products")
    .select(
      `
      id, zepto_sku, slug, name, brand, super_category, category, subcategory,
      net_weight, price_inr, mrp_inr, image_urls, product_url, barcode,
      ingredients_raw, nutrition, attributes, raw_payload, scraped_at, updated_at,
      platform, ocr_status, ocr_image_url,
      core_scores (product_id, score, grade, band, subscores, concerns, breakdown, rule_version, computed_at, ${DETAIL_SCORE_FIELDS})
    `,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const scores = row.core_scores;
  let core: CoreScore | null = null;
  if (scores && typeof scores === "object") {
    const s = Array.isArray(scores) ? scores[0] : scores;
    if (s && typeof s === "object") core = s as CoreScore;
  }
  if (core && core.absolute_score != null) core.score = core.absolute_score;

  return {
    id: row.id as string,
    zepto_sku: row.zepto_sku as string,
    slug: row.slug as string,
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    super_category: (row.super_category as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    subcategory: (row.subcategory as string | null) ?? null,
    l3_category:
      (row.l3_category as string | null) ??
      ((row.attributes as Record<string, string> | null)?.["L3 Category"] ?? null),
    net_weight: (row.net_weight as string | null) ?? null,
    price_inr: row.price_inr != null ? Number(row.price_inr) : null,
    mrp_inr: row.mrp_inr != null ? Number(row.mrp_inr) : null,
    image_urls: normalizeProductImageUrls((row.image_urls as string[]) ?? [], {
      ocrImageUrl: (row.ocr_image_url as string | null) ?? null,
      ocrPayload: (row.ocr_payload as Record<string, unknown> | null) ?? null,
    }),
    product_url: (row.product_url as string | null) ?? null,
    barcode: (row.barcode as string | null) ?? null,
    ingredients_raw: (row.ingredients_raw as string | null) ?? null,
    nutrition: (row.nutrition as ProductNutrition | null) ?? null,
    attributes: (row.attributes as Record<string, string> | null) ?? null,
    raw_payload: (row.raw_payload as Record<string, unknown> | null) ?? null,
    scraped_at: row.scraped_at as string,
    updated_at: row.updated_at as string,
    platform: (row.platform as string | null) ?? null,
    data_source: row.platform === "zepto" ? "csv" : "scrape",
    ocr_status: (row.ocr_status as string | null) ?? null,
    ocr_payload: (row.ocr_payload as Record<string, unknown> | null) ?? null,
    ocr_image_url: (row.ocr_image_url as string | null) ?? null,
    core_scores: core,
  };
}

/** Real product for homepage hero — prefer a scored snack with nutrition. */
export async function getFeaturedSample(): Promise<ProductListItem | null> {
  const items = await searchProducts({ onlyScored: true, onlyWithDetail: true, limit: 80 });
  const pick =
    items.find(
      (p) =>
        p.nutrition &&
        p.core_scores &&
        p.core_scores.score >= 35 &&
        p.core_scores.score <= 55 &&
        /noodle|chips|chocolate|cola|biscuit/i.test(p.name),
    ) ?? items.find((p) => p.core_scores && p.nutrition) ?? items[0];
  return pick ?? null;
}

/**
 * Homepage data — diverse hero showcase + 3 curated rails. Server component, fast.
 */
export type HomeShelves = {
  /** 6-card hero showcase mixing verdicts to communicate what the site does */
  showcase: ProductListItem[];
  dailyStaples: ProductListItem[];
  skipWorthy: ProductListItem[];
  bestValue: ProductListItem[];
  occasionalTreats: ProductListItem[];
  totalScored: number;
  catalogSize: number;
};

/** Pool size per verdict rail — ~7× the display count for daily rotation. */
const HOME_POOL_LIMIT = 70;
const HOME_RAIL_COUNT = 6;

function homeDaySeed(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function hashSeed(id: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Deterministic shuffle — changes daily, stable within a day for caching. */
function seededPick<T extends { id: string }>(items: T[], count: number, seed: number): T[] {
  return [...items]
    .sort((a, b) => hashSeed(a.id, seed) - hashSeed(b.id, seed))
    .slice(0, count);
}

/** Seeded pick with a per-subcategory cap so a rail isn't 80% milk + yoghurt.
 *  Greedy over a seeded shuffle: take up to `maxPerSub` from each subcategory,
 *  then backfill from the overflow if we're short. */
function seededDiversePick<
  T extends { id: string; subcategory?: string | null; category?: string | null },
>(items: T[], count: number, seed: number, maxPerSub = 2): T[] {
  const shuffled = [...items].sort((a, b) => hashSeed(a.id, seed) - hashSeed(b.id, seed));
  const perSub = new Map<string, number>();
  const out: T[] = [];
  const overflow: T[] = [];
  for (const p of shuffled) {
    if (out.length >= count) break;
    const key = (p.subcategory ?? p.category ?? "other").trim().toLowerCase();
    const n = perSub.get(key) ?? 0;
    if (n < maxPerSub) {
      perSub.set(key, n + 1);
      out.push(p);
    } else {
      overflow.push(p);
    }
  }
  for (const p of overflow) {
    if (out.length >= count) break;
    out.push(p);
  }
  return out.slice(0, count);
}

export async function getHomeShelves(): Promise<HomeShelves> {
  const supabase = db();
  const select = `${LIST_FIELDS}, core_scores!inner (${LIST_SCORE_FIELDS})`;
  const seed = homeDaySeed();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseQ = (verdict: string | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("products")
      .select(select)
      .eq("platform", "zepto")
      .eq("catalog_visible", true)
      .not("image_urls", "is", null);
    if (verdict) q = q.eq("core_scores.verdict", verdict);
    return q;
  };

  const [staplesRes, skipsRes, valueRes, treatsRes, statsRes] = await Promise.all([
    baseQ("daily_staple")
      .order("absolute_score", { referencedTable: "core_scores", ascending: false, nullsFirst: false })
      .limit(HOME_POOL_LIMIT),
    baseQ("skip")
      .order("absolute_score", { referencedTable: "core_scores", ascending: true, nullsFirst: false })
      .limit(HOME_POOL_LIMIT),
    baseQ("good_choice")
      .order("absolute_score", { referencedTable: "core_scores", ascending: false, nullsFirst: false })
      .limit(HOME_POOL_LIMIT),
    baseQ("occasional_treat")
      .order("absolute_score", { referencedTable: "core_scores", ascending: false, nullsFirst: false })
      .limit(HOME_POOL_LIMIT),
    // Count what users can actually browse (visible catalog), so the landing
    // numbers agree with /insights and /search rather than raw table sizes.
    Promise.all([
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("platform", "zepto")
        .eq("catalog_visible", true),
      supabase
        .from("products")
        .select("id, core_scores!inner(product_id)", { count: "exact", head: true })
        .eq("platform", "zepto")
        .eq("catalog_visible", true),
    ]),
  ]);

  const filterReady = (p: ProductListItem) => p.image_urls.length > 0 && p.brand;
  const staples = ((staplesRes.data ?? []) as Record<string, unknown>[])
    .map(mapListRow)
    .filter(filterReady);
  const skips = ((skipsRes.data ?? []) as Record<string, unknown>[])
    .map(mapListRow)
    .filter(filterReady);
  const value = ((valueRes.data ?? []) as Record<string, unknown>[])
    .map(mapListRow)
    .filter(filterReady);
  const treats = ((treatsRes.data ?? []) as Record<string, unknown>[])
    .map(mapListRow)
    .filter(filterReady);

  // Staples skew heavily dairy (milk/yoghurt dominate daily_staple) — cap per
  // subcategory so the rail shows the real range of "buy every week".
  const pickStaples = seededDiversePick(staples, 10, seed + 1, 2);
  const pickSkips = seededPick(skips, HOME_RAIL_COUNT + 2, seed + 2);
  const pickValue = seededPick(value, HOME_RAIL_COUNT + 2, seed + 3);
  const pickTreats = seededPick(treats, HOME_RAIL_COUNT + 2, seed + 4);

  const showcase = [
    pickStaples[0],
    pickSkips[0],
    pickValue[0],
    pickStaples[1],
    pickSkips[1],
    pickTreats[0] ?? pickValue[1],
  ].filter((p): p is ProductListItem => Boolean(p));

  return {
    showcase,
    dailyStaples: pickStaples.slice(0, 10),
    skipWorthy: pickSkips.slice(0, HOME_RAIL_COUNT),
    bestValue: pickValue.slice(0, HOME_RAIL_COUNT),
    occasionalTreats: pickTreats.slice(0, HOME_RAIL_COUNT),
    catalogSize: statsRes[0].count ?? 0,
    totalScored: statsRes[1].count ?? 0,
  };
}

/** Top N products in a cohort by absolute score — for "best in category" tooltip. */
export async function getTopInCohort(
  cohortId: string,
  limit = 10,
): Promise<Array<{ id: string; name: string; brand: string | null; slug: string; score: number; absolute_score: number; image_url: string | null }>> {
  const supabase = db();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("core_scores")
    .select("score, absolute_score, products!inner(id, name, brand, slug, image_urls)")
    .eq("cohort_id", cohortId)
    .order("absolute_score", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((row) => {
    const p = row.products;
    const images = (p.image_urls as string[] | null) ?? [];
    return {
      id: p.id as string,
      name: p.name as string,
      brand: (p.brand as string | null) ?? null,
      slug: p.slug as string,
      score: row.score as number,
      absolute_score: row.absolute_score as number,
      image_url: images[0] ?? null,
    };
  });
}

export async function countCatalog(): Promise<{
  total: number;
  scored: number;
  withDetail: number;
}> {
  const supabase = db();

  const [totalRes, detailRes, scoredRes] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("platform", "zepto"),
    supabase.from("core_scores").select("product_id", { count: "exact", head: true }),
  ]);

  return {
    total: totalRes.count ?? 0,
    withDetail: detailRes.count ?? 0,
    scored: scoredRes.count ?? 0,
  };
}
