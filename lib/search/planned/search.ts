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
import { needsVerification, verifyInChunks, type Verdict } from "./verify";
import { loadVocabulary } from "./vocabulary";
import { abortableQuery, createDeadline, throwIfAborted } from "./runtime";
import { lockRequirements, preserveRequirements, sensitiveRequest } from "@/lib/shopping/policy";

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
  timings: {
    /** Planner call only; zero when a cached plan is used. */
    plan_ms: number;
    /** Provider duration, which can overlap vocabulary loading and planning. */
    embed_ms: number;
    execute_ms: number;
    verify_ms: number;
    total_ms: number;
    plan_cached: boolean;
    /** Includes the first DB connection when the pool is cold. */
    vocab_ms?: number;
    plan_cache_ms?: number;
    /** Time actually blocking on the embedding after the plan is ready. */
    embedding_wait_ms?: number;
    attach_sizes_ms?: number;
  };
  llm: { calls: number; prompt_tokens: number; completion_tokens: number };
  dropped: string[];
  /** Offset for the next page of verified results, or null when nothing more matches. */
  next_offset: number | null;
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
async function attachSizes(sql: Sql, items: PlannedSearchItem[], signal?: AbortSignal): Promise<PlannedSearchItem[]> {
  throwIfAborted(signal);
  const keys = [...new Set(items.map(i => i.variant_key).filter((k): k is string => !!k))];
  if (!keys.length) return items;
  const rows = await abortableQuery(sql<(SizeOption & { variant_key: string })[]>`
    select f.variant_key, p.id product_id, p.slug, p.net_weight, p.price_inr::float8 price_inr, f.price_per_100::float8 price_per_100
    from product_facts f join products p on p.id = f.product_id
    where p.catalog_visible and f.variant_key = any(${keys}::text[])
    order by f.variant_key, f.pack_qty nulls last, p.price_inr`, signal);
  const byKey = new Map<string, SizeOption[]>();
  for (const { variant_key, ...size } of rows) byKey.set(variant_key, [...(byKey.get(variant_key) ?? []), size]);
  return items.map(i => {
    const sizes = i.variant_key ? byKey.get(i.variant_key) : undefined;
    return sizes && sizes.length > 1 ? { ...i, sizes } : i;
  });
}

export type PlannedSearchOptions = { preferences?: Preferences; limit?: number; verify?: boolean; offset?: number; signal?: AbortSignal; timeoutMs?: number };

export async function plannedSearch(query: string, opts: PlannedSearchOptions = {}): Promise<PlannedSearchResult> {
  const deadline = createDeadline(opts.timeoutMs ?? 50_000, opts.signal);
  const signal = deadline.signal;
  const embeddingScope = createDeadline(undefined, signal);
  let embedding: Promise<{ e: number[] | null; ms: number }> = Promise.resolve({ e: null, ms: 0 });
  let planWrite: Promise<void> = Promise.resolve();
  try {
    const started = Date.now();
    throwIfAborted(signal);
    const sql = searchSql();
    const prefs = opts.preferences ?? null;
    const limit = opts.limit ?? 24;
    // Later pages ("Show more") rank the same candidates and verify the next slice.
    const offset = Math.max(0, opts.offset ?? 0);
    const llm = { calls: 0, prompt_tokens: 0, completion_tokens: 0 };
    const addUsage = (u: unknown) => {
      const x = u as { prompt_tokens?: number; completion_tokens?: number } | null;
      llm.calls += 1;
      llm.prompt_tokens += x?.prompt_tokens ?? 0;
      llm.completion_tokens += x?.completion_tokens ?? 0;
    };

    const embedStarted = Date.now();
    embedding = isEmbeddingConfigured()
      ? embedText(query, "query", embeddingScope.signal).then(e => ({ e, ms: Date.now() - embedStarted })).catch(() => ({ e: null, ms: Date.now() - embedStarted }))
      : Promise.resolve({ e: null as number[] | null, ms: 0 });

    const vocabStarted = Date.now();
    const vocab = await loadVocabulary(sql, signal);
    throwIfAborted(signal);
    const vocabMs = Date.now() - vocabStarted;
    const key = planCacheKey(query, prefs, plannerFingerprint(vocab));
    let plan: SearchPlan, dropped: string[], planMs = 0, planCached = false;
    const planCacheStarted = Date.now();
    const cached = await getCachedPlan(sql, key, signal);
    throwIfAborted(signal);
    const planCacheMs = Date.now() - planCacheStarted;
    if (cached) {
      ({ plan, dropped } = cached);
      planCached = true;
    } else {
      try {
        const r = await planQuery(query, vocab, prefs, signal);
        throwIfAborted(signal);
        addUsage(r.usage);
        ({ plan, dropped } = r);
        planMs = r.ms;
        planWrite = Promise.resolve(storePlan(sql, key, plan, dropped, signal));
      } catch (error) {
        throwIfAborted(signal);
        // Never fall back to unfiltered results when planning is unavailable.
        console.error("[planned-search] planner failed", error instanceof Error ? error.message : error);
        // No unconstrained fallback: the unavailable planner may have missed an allergy.
        throw new Error("Search requirements could not be checked. Please try again.");
      }
    }

    throwIfAborted(signal);
    if (dropped.includes("planner:degraded") || dropped.some(x => /^(concept|claim|numeric):/.test(x))) throw new Error("Some search requirements could not be checked. Please try again.");
    plan = lockRequirements(preserveRequirements(plan, query, prefs), query);
    const sensitive = sensitiveRequest(plan, query);

    if (plan.intent === "non_food" || plan.intent === "unclear") {
      await planWrite;
      throwIfAborted(signal);
      return {
        query, plan, items: [], unconfirmed: [], relaxed: [], counts: [], reference: null, dropped, llm, next_offset: null,
        summary: plan.intent === "non_food"
          ? "Scout covers packaged food and drinks only."
          : "Couldn't understand that as a food search — try describing what you want to eat or drink.",
        timings: {
          plan_ms: planMs, embed_ms: 0, execute_ms: 0, verify_ms: 0,
          total_ms: Date.now() - started, plan_cached: planCached,
          vocab_ms: vocabMs, plan_cache_ms: planCacheMs, embedding_wait_ms: 0, attach_sizes_ms: 0,
        },
      };
    }

    // The embedding overlaps planning; never let a slow provider stall the search.
    const embeddingWaitStarted = Date.now();
    const grace = setTimeout(() => embeddingScope.abort(new DOMException("Embedding grace period ended", "TimeoutError")), EMBED_GRACE_MS);
    let embedded: { e: number[] | null; ms: number };
    try { embedded = await embedding; }
    finally { clearTimeout(grace); }
    throwIfAborted(signal);
    const { e: vector, ms: embedMs } = embedded;
    const embeddingWaitMs = Date.now() - embeddingWaitStarted;
    const exec = await executePlan(sql, plan, vector, { limit: offset + limit, vocab, signal });
    throwIfAborted(signal);

    let confirmed: PlannedSearchItem[] = collapseVariants(exec.items.filter(i => i.confirmation === "confirmed"));
    const unconfirmed: PlannedSearchItem[] = collapseVariants(exec.items.filter(i => i.confirmation !== "confirmed"));
    let verifyMs = 0;

    // Results reached by widening the scope always get checked against the request.
    const verify = sensitive || (opts.verify ?? (needsVerification(plan) || exec.relaxed.includes("scope")));
    const ranked = diversify(confirmed);
    const page = ranked.slice(offset, offset + limit);
    const nextOffset = ranked.length > offset + limit ? offset + limit : null;
    confirmed = page;
    if (verify && page.length) {
      // Verify everything that can be shown, in parallel batches; never append an unverified tail.
      const v = await verifyInChunks(query, plan, page, signal);
      throwIfAborted(signal);
      v.usages.forEach(addUsage);
      verifyMs = v.ms;
      const judged = page.map(i => ({ ...i, verdict: v.verdicts.get(i.product_id)?.v, why: v.verdicts.get(i.product_id)?.why }));
      // Sensitive results require an explicit verdict. Timeouts, invalid JSON and
      // omitted cards never turn into a claim of suitability.
      const kept = judged.filter(i => i.verdict !== "no" && (!sensitive || i.verdict === "good" || i.verdict === "ok"));
      confirmed = plan.sort.field === "relevance"
        ? [...kept.filter(i => i.verdict === "good"), ...kept.filter(i => i.verdict === "ok"), ...kept.filter(i => !i.verdict)]
        : kept;
    }

    const isRelaxed = (i: PlannedSearchItem) => i.notes.some(n => n.startsWith("relaxed "));
    confirmed = [...confirmed.filter(i => !isRelaxed(i)), ...confirmed.filter(isRelaxed).map(i => ({ ...i, relaxed: true }))];

    const shown = diversify(confirmed).slice(0, limit);
    // Unconfirmed near-misses belong to the first page only.
    const extra = !sensitive && offset === 0 ? unconfirmed.slice(0, 12) : [];
    const attachSizesStarted = Date.now();
    const withSizes = sensitive ? [...shown, ...extra] : await attachSizes(sql, [...shown, ...extra], signal).catch(error => {
      throwIfAborted(signal);
      return [...shown, ...extra];
    });
    const attachSizesMs = Date.now() - attachSizesStarted;
    throwIfAborted(signal);
    const items = withSizes.slice(0, shown.length);
    const summary = items.length
      ? plan.summary || `${items.length} matches`
      : extra.length
        ? "No product's label fully confirms your request. Closest options are listed as unconfirmed."
        : sensitive ? "No products could be confirmed for all your requirements. Please try again or check the package label." : "No products match this request.";

    await planWrite;
    throwIfAborted(signal);
    return {
      query, plan, items, unconfirmed: withSizes.slice(shown.length), relaxed: exec.relaxed, counts: exec.counts,
      reference: exec.reference, summary, dropped, llm, next_offset: nextOffset,
      timings: {
        plan_ms: planMs, embed_ms: embedMs, execute_ms: exec.ms, verify_ms: verifyMs,
        total_ms: Date.now() - started, plan_cached: planCached,
        vocab_ms: vocabMs, plan_cache_ms: planCacheMs,
        embedding_wait_ms: embeddingWaitMs, attach_sizes_ms: attachSizesMs,
      },
    };
  } finally {
    // Abort optional speculation and pending cache IO, then wait for cleanup.
    // The shelf queue must not start more work while a timed-out SQL query runs.
    deadline.abort();
    embeddingScope.abort();
    await Promise.allSettled([embedding, planWrite]);
    embeddingScope.dispose();
    deadline.dispose();
  }
}
