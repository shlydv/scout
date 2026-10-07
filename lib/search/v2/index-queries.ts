import { adminClient } from "@/lib/supabase/admin";
import { getSearchPool } from "@/lib/search/v2/db-pool";
import { buildIndexCatalogMeta, type IndexCatalogMeta } from "@/lib/search/v2/index-meta";
import { embedText } from "@/lib/search/v2/embeddings";
import { SEED_GOAL_TRAIT_MAP } from "@/lib/search/v2/goal-graph";
import type {
  CategoryTraitProfileRow,
  DietaryPrevalenceMap,
  GoalTraitMapRow,
  ProductSearchIndexRow,
} from "@/lib/search/v2/types";

export type SearchIndexSnapshot = {
  index: ProductSearchIndexRow[];
  profiles: CategoryTraitProfileRow[];
  goalMap: Map<string, GoalTraitMapRow>;
  catalogMeta: IndexCatalogMeta;
  source: "db" | "memory" | "pgvector";
  dietary_prevalence: DietaryPrevalenceMap;
  /** Pre-loaded type centroids for in-memory cosine matching — avoids
   *  8s RPC calls to search_v2_type_matches. Populated during snapshot init. */
  typeCentroids: Map<string, number[]>;
  /** Category→primary_type siblings — built from product_search_index at
   *  snapshot load. Expands type matching for weak centroids (snacks→chips). */
  categoryTypeMap: Map<string, string[]> | null;
  /** Auto-detected type normalization — sparse types mapped to dominant twins.
   *  "milk shake" (1) → "milkshake" (81). For lookup only, both types show. */
  typeNormalize: Map<string, string> | null;
  /** Lazy-loaded — populated on first access, not during snapshot init */
  _goalMapLoaded: boolean;
  _profilesLoaded: boolean;
};

async function loadFacets(): Promise<IndexCatalogMeta> {
  // Prefer static JSON (0ms, built during index rebuild).
  // Falls back to Supabase summary table → RPC → empty.
  try {
    const { brands, primary_types } = await import("@/data/catalog-facets.json") as {
      brands: string[];
      primary_types: string[];
    };
    if (brands?.length) {
      return {
        brands: new Set(brands.map((b) => b.toLowerCase())),
        primaryTypes: new Set((primary_types ?? []).map((t) => t.toLowerCase())),
        flavours: new Set(),
      };
    }
  } catch { /* file missing — fall through to Supabase */ }

  try {
    const supabase = adminClient();
    // Try the cached summary table (~50ms vs 1-2s RPC)
    const { data: cached } = await supabase
      .from("catalog_facets")
      .select("brands, primary_types")
      .eq("id", 1)
      .maybeSingle();
    const row = cached as { brands?: string[]; primary_types?: string[] } | null;
    if (row?.brands?.length) {
      return {
        brands: new Set(row.brands.map((b) => b.toLowerCase())),
        primaryTypes: new Set((row.primary_types ?? []).map((t) => t.toLowerCase())),
        flavours: new Set(),
      };
    }
    // Last resort: slow RPC
    const { data } = await supabase.rpc("search_v2_facets");
    const obj = (data ?? {}) as { brands?: string[]; primary_types?: string[]; flavours?: string[] };
    return {
      brands: new Set((obj.brands ?? []).map((b) => b.toLowerCase())),
      primaryTypes: new Set((obj.primary_types ?? []).map((t) => t.toLowerCase())),
      flavours: new Set((obj.flavours ?? []).map((f) => f.toLowerCase())),
    };
  } catch {
    return { brands: new Set(), primaryTypes: new Set(), flavours: new Set() };
  }
}

let cachedSnapshot: { data: SearchIndexSnapshot; at: number } | null = null;
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

export { mapDbRow } from "@/lib/search/decision/index-row";
import { mapDbRow, parseVector } from "@/lib/search/decision/index-row";

async function loadGoalMapFromDb(): Promise<Map<string, GoalTraitMapRow>> {
  const map = new Map<string, GoalTraitMapRow>();

  // DB FIRST — rows carry persisted goal embeddings (seeded at build time).
  // The old order embedded every seed via Voyage on each cold instance and then
  // immediately overwrote them with these DB rows: ~16 wasted network calls on
  // the cold path. A populated table now costs ZERO embedding calls.
  try {
    const supabase = adminClient();
    const { data } = await supabase.from("goal_trait_map").select("*");
    for (const row of data ?? []) {
      map.set(String(row.goal_id), {
        goal_id: String(row.goal_id),
        goal_phrase: String(row.goal_phrase ?? row.display_name),
        display_name: String(row.display_name),
        trait_weights: (row.trait_weights as GoalTraitMapRow["trait_weights"]) ?? {},
        goal_embedding: parseVector(row.goal_embedding),
        source: String(row.source ?? "seed"),
        confidence: Number(row.confidence ?? 1),
        support_count: Number(row.support_count ?? 0),
      });
    }
  } catch {
    // table may not exist
  }

  // Embed only the gaps (fresh env / seed missing or stored without embedding).
  const missing = SEED_GOAL_TRAIT_MAP.filter(
    (seed) => !map.get(seed.goal_id)?.goal_embedding?.length,
  );
  if (missing.length) {
    const embeds = await Promise.all(
      missing.map((seed) => embedText(seed.goal_phrase, "document")),
    );
    missing.forEach((seed, i) => {
      const embed = embeds[i] ?? [];
      map.set(seed.goal_id, {
        ...seed,
        goal_embedding: embed.length ? embed : null,
      });
    });
  }
  return map;
}

async function loadProfilesFromDb(): Promise<CategoryTraitProfileRow[] | null> {
  try {
    const supabase = adminClient();
    const { data, error } = await supabase.from("category_trait_profile").select("*");
    if (error || !data?.length) return null;
    return data.map((row) => ({
      category_key: String(row.category_key),
      category: (row.category as string) ?? null,
      subcategory: (row.subcategory as string) ?? null,
      trait_means: (row.trait_means as CategoryTraitProfileRow["trait_means"]) ?? {},
      trait_centroid: parseVector(row.trait_centroid),
      product_count: Number(row.product_count ?? 0),
    }));
  } catch {
    return null;
  }
}

/** Slim column list — everything the ranking pipeline reads EXCEPT the two 1024-dim
 *  vectors (~24KB/row as JSON). Vector relevance arrives as knn_distance from the RPC. */
export const INDEX_COLUMNS =
  "product_id,canonical_product_id,slug,name,brand,category,subcategory,l3_category,primary_type,base_name,form,flavours,variants,is_veg,is_vegan,is_gluten_free,is_jain,is_palm_oil_free,has_added_sugar,allergens,claims,sugar_g,protein_g,fat_g,saturated_fat_g,sodium_mg,energy_kcal,total_protein_g,total_sugar_g,total_fat_g,total_calories,calcium_mg,iron_mg,fiber_g,carbs_g,price_inr,sugar_tier,protein_tier,fat_tier,traits,trait_source,trait_confidence,trait_reasons,scout_score,absolute_score,category_rank,category_size,category_label,nova_group,data_quality_score,data_completeness,facet_confidence,brand_tier,pack_size_value,pack_size_unit,use_cases,search_doc,click_count,save_count,last_interaction_at,built_at,source_hash";

async function loadIndexFromDb(): Promise<ProductSearchIndexRow[] | null> {
  try {
    const supabase = adminClient();
    // Paginate — PostgREST caps a single response at ~1000 rows. Pages carry
    // ~12KB of embedding JSON per row, so SEQUENTIAL paging made cold starts
    // pay 17+ serial round-trips (10s+). Count first, then fetch all pages in
    // parallel waves — cold load drops to roughly the latency of one page.
    const PAGE = 1000;
    // 3 concurrent pages is the sweet spot on the current DB tier: each page
    // carries ~12MB of embedding JSON, and wider waves contend on I/O until
    // every statement hits the timeout. One retry per page, partial-tolerant.
    const CONCURRENCY = 3;

    const { count, error: countErr } = await supabase
      .from("product_search_index")
      .select("*", { count: "exact", head: true });
    if (countErr || !count) return null;

    const fetchPage = async (p: number): Promise<Record<string, unknown>[]> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabase
          .from("product_search_index")
          .select(INDEX_COLUMNS)
          .order("product_id", { ascending: true })
          .range(p * PAGE, p * PAGE + PAGE - 1);
        if (!error) return (data ?? []) as Record<string, unknown>[];
      }
      return [];
    };

    const pageCount = Math.ceil(Math.min(count, 50_000) / PAGE);
    const pages: Record<string, unknown>[][] = new Array(pageCount);
    for (let wave = 0; wave < pageCount; wave += CONCURRENCY) {
      const slice = Array.from(
        { length: Math.min(CONCURRENCY, pageCount - wave) },
        (_, i) => wave + i,
      );
      const results = await Promise.all(slice.map(fetchPage));
      slice.forEach((p, i) => {
        pages[p] = results[i];
      });
    }

    const all: ProductSearchIndexRow[] = [];
    for (const page of pages) {
      for (const row of page ?? []) all.push(mapDbRow(row));
    }
    return all.length ? all : null;
  } catch {
    return null;
  }
}

/** Compute dietary attribute prevalence per primary_type via a lightweight COUNT query.
 *  Avoids loading the full index (which is never populated in the snapshot). */
async function loadDietaryPrevalence(): Promise<DietaryPrevalenceMap> {
  try {
    const db = await getSearchPool();
    if (!db) return {};
    // One GROUP BY with FILTER aggregates (was an RPC / unpaginated 1k-capped select).
    const rows = (await db`
      SELECT coalesce(nullif(trim(primary_type), ''), 'unknown') AS pt,
             count(*)::int AS total,
             count(*) FILTER (WHERE is_vegan)::int AS vegan,
             count(*) FILTER (WHERE is_gluten_free)::int AS gf,
             count(*) FILTER (WHERE is_palm_oil_free)::int AS pof,
             count(*) FILTER (WHERE is_jain)::int AS jain
      FROM product_search_index
      GROUP BY coalesce(nullif(trim(primary_type), ''), 'unknown')`) as Array<{
      pt: string; total: number; vegan: number; gf: number; pof: number; jain: number;
    }>;
    const out: DietaryPrevalenceMap = {};
    for (const r of rows) {
      out[r.pt] = {
        total: r.total,
        is_vegan: r.total > 0 ? r.vegan / r.total : 0,
        is_gluten_free: r.total > 0 ? r.gf / r.total : 0,
        is_palm_oil_free: r.total > 0 ? r.pof / r.total : 0,
        is_jain: r.total > 0 ? r.jain / r.total : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function clearSearchIndexSnapshotCache(): void {
  cachedSnapshot = null;
}

/** Load all type centroids from the DB — ~1,086 rows, ~5 MB in memory.
 *  Enables in-memory cosine matching instead of the 8s RPC call. */
async function loadTypeCentroids(): Promise<Map<string, number[]>> {
  const centroids = new Map<string, number[]>();
  const db = await getSearchPool();
  if (!db) return centroids;
  // One round-trip over the native protocol (was 5 paginated PostgREST pages).
  const rows = (await db`SELECT primary_type, centroid FROM type_centroids`) as Array<{
    primary_type: string;
    centroid: unknown;
  }>;
  for (const r of rows) {
    if (r.centroid) {
      const vec = typeof r.centroid === "string" ? (JSON.parse(r.centroid) as number[]) : (r.centroid as number[]);
      centroids.set(r.primary_type.toLowerCase(), vec);
    }
  }
  return centroids;
}

/** Build category→primary_type sibling map from the search index.
 *  Used to expand type matching when centroids are sparse —
 *  "snacks" in category "munchies" also matches chips, namkeen, etc. */
async function loadCategoryTypeMap(): Promise<Map<string, string[]>> {
  const catMap = new Map<string, string[]>();
  const typeCatCount = new Map<string, Map<string, number>>(); // type → category → count
  const db = await getSearchPool();
  if (!db) return new Map();
  // One GROUP BY (was up to 11 paginated full-table scans).
  const rows = (await db`
    SELECT trim(category) AS cat, lower(trim(primary_type)) AS pt, count(*)::int AS n
    FROM product_search_index
    WHERE primary_type IS NOT NULL AND trim(primary_type) <> '' AND category IS NOT NULL AND trim(category) <> ''
    GROUP BY trim(category), lower(trim(primary_type))`) as Array<{ cat: string; pt: string; n: number }>;
  for (const r of rows) {
    const cat = r.cat;
    const pt = r.pt;
    if (!catMap.has(cat)) catMap.set(cat, []);
    const siblings = catMap.get(cat)!;
    if (!siblings.includes(pt)) siblings.push(pt);
    if (!typeCatCount.has(pt)) typeCatCount.set(pt, new Map());
    typeCatCount.get(pt)!.set(cat, r.n);
  }
  // For each primary_type, pick its dominant category (most products) and return siblings
  const typeToSiblings = new Map<string, string[]>();
  for (const [pt, catCounts] of typeCatCount) {
    let bestCat = "";
    let bestCount = 0;
    for (const [cat, count] of catCounts) {
      if (count > bestCount) { bestCat = cat; bestCount = count; }
    }
    const siblings = (catMap.get(bestCat) ?? []).filter(s => s !== pt);
    typeToSiblings.set(pt, siblings);
  }
  return typeToSiblings;
}

/** Auto-detect type normalisation: sparse types (< 10 products) that have a
 *  dominant twin (same name after stripping spaces/underscores/dashes) get
 *  mapped to the richer type. "milk shake" (1 product) → "milkshake" (81).
 *  Used for type expansion lookups only — products of both types still appear. */
async function loadTypeNormalize(): Promise<Map<string, string>> {
  const counts = new Map<string, number>();
  const db = await getSearchPool();
  if (!db) return new Map();
  const rows = (await db`
    SELECT lower(trim(primary_type)) AS pt, count(*)::int AS n
    FROM product_search_index
    WHERE primary_type IS NOT NULL AND trim(primary_type) <> ''
    GROUP BY lower(trim(primary_type))`) as Array<{ pt: string; n: number }>;
  for (const r of rows) counts.set(r.pt, r.n);

  const norm = new Map<string, string>();
  const canon = (t: string) => t.replace(/[_\-\s]+/g, "");
  for (const [type, count] of counts) {
    if (count >= 10) continue; // only normalize sparse types
    const key = canon(type);
    // Find a dominant type with the same canonical form and > count
    let best: string | null = null;
    let bestCount = count;
    for (const [other, oc] of counts) {
      if (other === type) continue;
      if (canon(other) === key && oc > bestCount) {
        best = other;
        bestCount = oc;
      }
    }
    if (best) norm.set(type, best);
  }
  return norm;
}

export async function getSearchIndexSnapshot(forceRefresh = false): Promise<SearchIndexSnapshot> {
  if (!forceRefresh && cachedSnapshot && Date.now() - cachedSnapshot.at < SNAPSHOT_TTL_MS) {
    return cachedSnapshot.data;
  }

  // Only load facets + dietary + type centroids eagerly — goalMap + profiles
  // are lazy-loaded on first access since they're only needed for goal queries (~10%).
  const _time = async <T>(label: string, p: Promise<T>): Promise<T> => {
    const t = Date.now();
    const r = await p;
    if (process.env.SEARCH_TIMING === "1") console.log(`[timing] snapshot ${label}: ${Date.now() - t}ms`);
    return r;
  };
  const [catalogMeta, dietary_prevalence, typeCentroids, categoryTypeMap, typeNormalize] = await Promise.all([
    _time("loadFacets", loadFacets()),
    _time("loadDietaryPrevalence", loadDietaryPrevalence()),
    _time("loadTypeCentroids", loadTypeCentroids()),
    _time("loadCategoryTypeMap", loadCategoryTypeMap()),
    _time("loadTypeNormalize", loadTypeNormalize()),
  ]);
  const snap: SearchIndexSnapshot = {
    index: [],
    profiles: [],
    goalMap: new Map(),
    catalogMeta,
    source: "pgvector",
    dietary_prevalence,
    typeCentroids,
    categoryTypeMap,
    typeNormalize,
    _goalMapLoaded: false,
    _profilesLoaded: false,
  };
  cachedSnapshot = { data: snap, at: Date.now() };
  return snap;
}

export async function ensureGoalMap(snap: SearchIndexSnapshot): Promise<Map<string, GoalTraitMapRow>> {
  if (snap._goalMapLoaded) return snap.goalMap;
  snap.goalMap = await loadGoalMapFromDb();
  snap._goalMapLoaded = true;
  return snap.goalMap;
}

export async function ensureProfiles(snap: SearchIndexSnapshot): Promise<CategoryTraitProfileRow[]> {
  if (snap._profilesLoaded) return snap.profiles;
  const raw = await loadProfilesFromDb();
  snap.profiles = raw ?? [];
  snap._profilesLoaded = true;
  return snap.profiles;
}


