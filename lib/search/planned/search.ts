/**
 * Planned search: plan (DeepSeek, cached) -> execute (SQL over facts) -> verify
 * (judgement queries only) -> collapse pack sizes. The query embedding runs in
 * parallel with planning.
 */
import { embedText, isEmbeddingConfigured } from "@/lib/search/embeddings";
import { searchSql, type Sql } from "./db";
import { executePlan, type PlannedItem } from "./execute";
import { getCachedPlan, planCacheKey, storePlan } from "./plan-cache";
import { planQuery, plannerFingerprint, type Preferences, type SearchPlan } from "./plan";
import { needsVerification, verifyItems, type Verdict } from "./verify";
import { loadVocabulary } from "./vocabulary";

export type SizeOption = { product_id: string; slug: string; net_weight: string | null; price_inr: number | null; price_per_100: number | null };
export type PlannedSearchItem = PlannedItem & { verdict?: Verdict; why?: string; relaxed?: boolean; sizes?: SizeOption[] };

export type PlannedSearchResult = {
  query: string;
  plan: SearchPlan;
  items: PlannedSearchItem[];
  unconfirmed: PlannedSearchItem[];
  relaxed: string[];
  counts: { step: string; matched: number; confirmed: number }[];
  reference: { query: string; value: number; products: string[] } | null;
  summary: string;
  timings: { plan_ms: number; embed_ms: number; execute_ms: number; verify_ms: number; total_ms: number; plan_cached: boolean };
  llm: { calls: number; prompt_tokens: number; completion_tokens: number };
  dropped: string[];
};

const EMBED_GRACE_MS = 1200;

export function degradedPlan(query: string): SearchPlan {
  return {
    intent: "product", l3: [], subcategories: [], categories: [], brands: [], name_terms: [],
    require: [], exclude: [], strict: false, claims_required: [], claims_preferred: [], diet: {},
    numeric: [], sort: { field: "relevance", dir: "desc" }, semantic_query: query, judge: [],
    relax: [], comparison: null, summary: "Closest matches",
  };
}

/** Keep near-duplicate product lines (same brand, different flavour) from flooding the top. */
export function diversify<T extends { brand: string | null; name: string }>(items: T[], maxPerLine = 2, window = 12): T[] {
  const lineKey = (it: T) => {
    const brand = (it.brand ?? "").toLowerCase();
    const words = it.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter(w => w && !brand.includes(w) && !/^\d/.test(w));
    return `${brand}|${words.slice(0, 3).join(" ")}`;
  };
  const head: T[] = [], overflow: T[] = [];
  const seen = new Map<string, number>();
  for (const it of items) {
    const k = lineKey(it);
    const n = seen.get(k) ?? 0;
    if (head.length < window && n >= maxPerLine) { overflow.push(it); continue; }
    seen.set(k, n + 1);
    head.push(it);
  }
  return [...head, ...overflow];
}

/** One card per pack-size group; the first (best-ranked) member represents it. */
export function collapseVariants<T extends { variant_key: string | null; product_id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(it => {
    const k = it.variant_key ?? it.product_id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** All visible sizes for each shown card, cheapest first (one query). */
async function attachSizes(sql: Sql, items: PlannedSearchItem[]): Promise<PlannedSearchItem[]> {
  const keys = [...new Set(items.map(i => i.variant_key).filter((k): k is string => !!k))];
  if (!keys.length) return items;
  const rows = await sql<(SizeOption & { variant_key: string })[]>`
    select f.variant_key, p.id product_id, p.slug, p.net_weight, p.price_inr::float8 price_inr, f.price_per_100::float8 price_per_100
    from product_facts f join products p on p.id = f.product_id
    where p.catalog_visible and f.variant_key = any(${keys}::text[])
    order by f.variant_key, f.pack_qty nulls last, p.price_inr`;
  const byKey = new Map<string, SizeOption[]>();
  for (const { variant_key, ...size } of rows) byKey.set(variant_key, [...(byKey.get(variant_key) ?? []), size]);
  return items.map(i => {
    const sizes = i.variant_key ? byKey.get(i.variant_key) : undefined;
    return sizes && sizes.length > 1 ? { ...i, sizes } : i;
  });
}

export async function plannedSearch(query: string, opts: { preferences?: Preferences; limit?: number; verify?: boolean } = {}): Promise<PlannedSearchResult> {
  const started = Date.now();
  const sql = searchSql();
  const prefs = opts.preferences ?? null;
  const limit = opts.limit ?? 24;
  const llm = { calls: 0, prompt_tokens: 0, completion_tokens: 0 };
  const addUsage = (u: unknown) => {
    const x = u as { prompt_tokens?: number; completion_tokens?: number } | null;
    llm.calls += 1;
    llm.prompt_tokens += x?.prompt_tokens ?? 0;
    llm.completion_tokens += x?.completion_tokens ?? 0;
  };

  const embedStarted = Date.now();
  const embedding = isEmbeddingConfigured()
    ? embedText(query, "query").then(e => ({ e, ms: Date.now() - embedStarted })).catch(() => ({ e: null, ms: Date.now() - embedStarted }))
    : Promise.resolve({ e: null as number[] | null, ms: 0 });

  const vocab = await loadVocabulary(sql);
  const key = planCacheKey(query, prefs, plannerFingerprint(vocab));
  let plan: SearchPlan, dropped: string[], planMs = 0, planCached = false;
  const cached = await getCachedPlan(sql, key);
  if (cached) {
    ({ plan, dropped } = cached);
    planCached = true;
    planMs = Date.now() - started;
  } else {
    try {
      const r = await planQuery(query, vocab, prefs);
      addUsage(r.usage);
      ({ plan, dropped } = r);
      planMs = r.ms;
      storePlan(sql, key, plan, dropped);
    } catch (error) {
      // Planner unavailable: closest matches only, no filters, clearly labelled.
      console.error("[planned-search] planner failed", error instanceof Error ? error.message : error);
      plan = degradedPlan(query);
      dropped = ["planner:degraded"];
      planMs = Date.now() - started;
    }
  }

  if (plan.intent === "non_food" || plan.intent === "unclear") {
    return {
      query, plan, items: [], unconfirmed: [], relaxed: [], counts: [], reference: null, dropped, llm,
      summary: plan.intent === "non_food"
        ? "Scout covers packaged food and drinks only."
        : "Couldn't understand that as a food search — try describing what you want to eat or drink.",
      timings: { plan_ms: planMs, embed_ms: 0, execute_ms: 0, verify_ms: 0, total_ms: Date.now() - started, plan_cached: planCached },
    };
  }

  // The embedding overlaps planning; never let a slow provider stall the search.
  const { e: vector, ms: embedMs } = await Promise.race([
    embedding,
    new Promise<{ e: null; ms: number }>(resolve => setTimeout(() => resolve({ e: null, ms: -1 }), EMBED_GRACE_MS)),
  ]);
  const exec = await executePlan(sql, plan, vector, { limit, vocab });

  let confirmed: PlannedSearchItem[] = collapseVariants(exec.items.filter(i => i.confirmation === "confirmed"));
  const unconfirmed: PlannedSearchItem[] = collapseVariants(exec.items.filter(i => i.confirmation !== "confirmed"));
  let verifyMs = 0;

  // Results reached by widening the scope always get checked against the request.
  const verify = opts.verify ?? (needsVerification(plan) || exec.relaxed.includes("scope"));
  if (verify && confirmed.length) {
    try {
      // Verify everything that can be shown; never append an unverified tail.
      const pool = diversify(confirmed).slice(0, Math.min(limit + 4, 28));
      const v = await verifyItems(query, plan, pool, pool.length);
      addUsage(v.usage);
      verifyMs = v.ms;
      const judged = pool.map(i => ({ ...i, verdict: v.verdicts.get(i.product_id)?.v, why: v.verdicts.get(i.product_id)?.why }));
      const kept = judged.filter(i => i.verdict !== "no");
      // Keep the requested numeric order; for relevance, strong fits first.
      confirmed = plan.sort.field === "relevance"
        ? [...kept.filter(i => i.verdict !== "ok"), ...kept.filter(i => i.verdict === "ok")]
        : kept;
    } catch {
      // Verification is a refinement; on failure keep the executor's results.
    }
  }

  const isRelaxed = (i: PlannedSearchItem) => i.notes.some(n => n.startsWith("relaxed "));
  confirmed = [...confirmed.filter(i => !isRelaxed(i)), ...confirmed.filter(isRelaxed).map(i => ({ ...i, relaxed: true }))];

  const shown = diversify(confirmed).slice(0, limit);
  const extra = unconfirmed.slice(0, 12);
  const withSizes = await attachSizes(sql, [...shown, ...extra]).catch(() => [...shown, ...extra]);
  const items = withSizes.slice(0, shown.length);
  const summary = items.length
    ? plan.summary || `${items.length} matches`
    : extra.length
      ? "No product's label fully confirms your request. Closest options are listed as unconfirmed."
      : "No products match this request.";

  return {
    query, plan, items, unconfirmed: withSizes.slice(shown.length), relaxed: exec.relaxed, counts: exec.counts,
    reference: exec.reference, summary, dropped, llm,
    timings: { plan_ms: planMs, embed_ms: embedMs, execute_ms: exec.ms, verify_ms: verifyMs, total_ms: Date.now() - started, plan_cached: planCached },
  };
}
