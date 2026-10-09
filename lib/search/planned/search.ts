/**
 * Planned search: plan (DeepSeek) -> execute (SQL over facts) -> verify (only
 * for judgement queries). The query embedding runs in parallel with planning.
 */
import { embedText, isEmbeddingConfigured } from "@/lib/search/v2/embeddings";
import { searchSql } from "./db";
import { executePlan, type PlannedItem } from "./execute";
import { planQuery, type Preferences, type SearchPlan } from "./plan";
import { needsVerification, verifyItems, type Verdict } from "./verify";
import { loadVocabulary } from "./vocabulary";

export type PlannedSearchItem = PlannedItem & { verdict?: Verdict; why?: string; relaxed?: boolean };

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

const PLAN_CACHE = new Map<string, { at: number; plan: SearchPlan; dropped: string[] }>();
const PLAN_TTL_MS = 6 * 60 * 60_000;
const EMBED_GRACE_MS = 1200;

export function degradedPlan(query: string): SearchPlan {
  return {
    intent: "product", l3: [], subcategories: [], categories: [], brands: [], name_terms: [],
    require: [], exclude: [], strict: false, claims_required: [], claims_preferred: [], diet: {},
    numeric: [], sort: { field: "relevance", dir: "desc" }, semantic_query: query, judge: [],
    relax: [], comparison: null, summary: "Closest matches",
  };
}

/** Keep near-duplicate variants (same brand + product line, different flavour/pack) from flooding the top. */
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

function cacheKey(query: string, prefs: Preferences): string {
  return JSON.stringify([query.trim().toLowerCase().replace(/\s+/g, " "), prefs ?? null]);
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

  const key = cacheKey(query, prefs);
  const hit = PLAN_CACHE.get(key);
  let plan: SearchPlan, dropped: string[], planMs = 0, planCached = false;
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) {
    ({ plan, dropped } = hit);
    planCached = true;
  } else {
    const vocab = await loadVocabulary(sql);
    try {
      const r = await planQuery(query, vocab, prefs);
      addUsage(r.usage);
      ({ plan, dropped } = r);
      planMs = r.ms;
      PLAN_CACHE.set(key, { at: Date.now(), plan, dropped });
    } catch (error) {
      // Planner unavailable: closest matches only, no filters, clearly labelled.
      console.error("[planned-search] planner failed", error instanceof Error ? error.message : error);
      plan = degradedPlan(query);
      dropped = ["planner:degraded"];
      planMs = Date.now() - started;
    }
  }

  // The embedding overlaps planning; never let a slow provider stall the search.
  if (plan.intent === "non_food" || plan.intent === "unclear") {
    return {
      query, plan, items: [], unconfirmed: [], relaxed: [], counts: [], reference: null, dropped, llm,
      summary: plan.intent === "non_food"
        ? "Scout covers packaged food and drinks only."
        : "Couldn't understand that as a food search — try describing what you want to eat or drink.",
      timings: { plan_ms: planMs, embed_ms: 0, execute_ms: 0, verify_ms: 0, total_ms: Date.now() - started, plan_cached: planCached },
    };
  }

  const { e: vector, ms: embedMs } = await Promise.race([
    embedding,
    new Promise<{ e: null; ms: number }>(resolve => setTimeout(() => resolve({ e: null, ms: -1 }), EMBED_GRACE_MS)),
  ]);
  const exec = await executePlan(sql, plan, vector, { limit, vocab: await loadVocabulary(sql) });

  let confirmed: PlannedSearchItem[] = exec.items.filter(i => i.confirmation === "confirmed");
  let unconfirmed: PlannedSearchItem[] = exec.items.filter(i => i.confirmation !== "confirmed");
  let verifyMs = 0;

  // Results reached by widening the scope always get checked against the request.
  const verify = opts.verify ?? (needsVerification(plan) || exec.relaxed.includes("scope"));
  if (verify && confirmed.length) {
    try {
      // Verify everything that can be shown; never append an unverified tail.
      const pool = diversify(confirmed).slice(0, Math.min(limit + 6, 30));
      const v = await verifyItems(query, plan, pool, pool.length);
      addUsage(v.usage);
      verifyMs = v.ms;
      const judged = pool.map(i => ({ ...i, verdict: v.verdicts.get(i.product_id)?.v, why: v.verdicts.get(i.product_id)?.why }));
      const kept = judged.filter(i => i.verdict !== "no");
      // Keep the requested numeric order; for relevance, strong fits first.
      const ordered = plan.sort.field === "relevance"
        ? [...kept.filter(i => i.verdict !== "ok"), ...kept.filter(i => i.verdict === "ok")]
        : kept;
      confirmed = ordered;
    } catch {
      // Verification is a refinement; on failure keep the executor's results.
    }
  }

  const isRelaxed = (i: PlannedSearchItem) => i.notes.some(n => n.startsWith("relaxed "));
  confirmed = [...confirmed.filter(i => !isRelaxed(i)), ...confirmed.filter(isRelaxed).map(i => ({ ...i, relaxed: true }))];

  const items = diversify(confirmed).slice(0, limit);
  const summary = items.length
      ? plan.summary || `${items.length} matches`
      : unconfirmed.length
        ? "No product's label fully confirms your request. Closest options are listed as unconfirmed."
        : "No products match this request.";

  return {
    query, plan, items, unconfirmed: unconfirmed.slice(0, 12), relaxed: exec.relaxed, counts: exec.counts,
    reference: exec.reference, summary, dropped, llm,
    timings: { plan_ms: planMs, embed_ms: embedMs, execute_ms: exec.ms, verify_ms: verifyMs, total_ms: Date.now() - started, plan_cached: planCached },
  };
}
