import { mergeUsage } from "@/lib/search/deepseek-client";
import { retrieveCandidates } from "@/lib/search/ai-retrieval";
import { rankCandidatesWithDeepseek } from "@/lib/search/ai-rank";
import {
  shouldEscalateStructuredToComplex,
  shouldUseLlmRank,
} from "@/lib/search/llm-rank-gate";
import {
  healthContextGoalFit,
  mergeDeterministicWithLlmRankings,
  rankCandidatesSemantically,
} from "@/lib/search/semantic-rank";
import type { SearchIntentTier } from "@/lib/search/intent-classify";
import {
  getAiSearchProductPool,
  searchProducts,
  type CatalogGridItem,
  type ProductListItem,
} from "@/lib/products/queries";
import type { ParsedProductQuery, QueryParseResult } from "@/lib/search/query-parse";
import type { DietaryPrevalenceMap } from "@/lib/search/v2/types";

export type AiSearchItem = CatalogGridItem & {
  ai_match_score: number;
  ai_health_score?: number;
  ai_match_reasons: string[];
  ai_match_warning?: string | null;
  /** §8 canonical cluster sibling count (expand on click) */
  canonical_variant_count?: number;
  /** §14 smart display chips — computed by getDisplayChips() in the V2 adapter */
  display_chips?: string[];
  /** Rich nutrition + trait data for search cards */
  primary_type?: string | null;
  sugar_g?: number | null;
  protein_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  is_vegan?: boolean | null;
  is_gluten_free?: boolean | null;
  is_palm_oil_free?: boolean | null;
  has_added_sugar?: boolean | null;
};

export type AiSearchResult = {
  parsed: ParsedProductQuery;
  parse_source: QueryParseResult["source"] | "cloudflare";
  rank_source: "deepseek" | "fallback" | "semantic" | "decision";
  decision?: { model: string; input_tokens: number | null; evaluated: number };
  intent_tier: SearchIntentTier;
  parse_warning?: string;
  rank_warning?: string;
  summary: string;
  items: AiSearchItem[];
  reasons_by_product_id: Record<string, string[]>;
  /** V1-style clickable query suggestions — not V2 relaxation text */
  refinements: string[];
  /** §11 non-clickable relaxation explanations (Search V2) */
  relaxation_explanations?: string[];
  usage?: QueryParseResult["usage"];
  limit: number;
  total: number;
  relaxed: boolean;
  /** Dietary prevalence map for smart chip suppression — populated by V2 adapter */
  dietary_prevalence?: DietaryPrevalenceMap;
  /** Search V2 metadata when SEARCH_V2_ENABLED */
  v2?: {
    goal_id: string | null;
    goal_phrase: string | null;
    llm_calls: number;
    latency_ms: number;
  };
};

const LLM_CANDIDATE_CAP = 40;
const TERM_SEARCH_LIMIT = 400;
const MIN_TERM_POOL = 30;

/** SQL-backed pool from parsed product terms — avoids loading 10k rows on cold start. */
async function getCatalogPoolForParsed(parsed: ParsedProductQuery): Promise<ProductListItem[]> {
  const terms = [
    ...parsed.product_terms,
    ...(parsed.search_keywords ?? []),
  ]
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (terms.length === 0) {
    return getAiSearchProductPool();
  }

  const byId = new Map<string, ProductListItem>();
  const queries = [...new Set(terms)].slice(0, 4);
  const pools = await Promise.all(
    queries.map((q) =>
      searchProducts({ q, limit: TERM_SEARCH_LIMIT, onlyWithDetail: true, onlyScored: false }),
    ),
  );
  for (const pool of pools) {
    for (const p of pool) byId.set(p.id, p);
  }

  if (byId.size >= MIN_TERM_POOL) {
    return [...byId.values()];
  }

  return getAiSearchProductPool();
}

function toAiGridItem(
  p: ProductListItem,
  parsed: ParsedProductQuery,
  score: number,
  reasons: string[],
  warning: string | null,
): AiSearchItem {
  const healthScore =
    healthContextGoalFit(p, parsed) ?? p.core_scores?.score ?? undefined;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    category: p.category,
    subcategory: p.subcategory,
    net_weight: p.net_weight,
    price_inr: p.price_inr,
    mrp_inr: p.mrp_inr,
    image_urls: p.image_urls?.length ? [p.image_urls[0]] : [],
    core_scores: p.core_scores
      ? {
          score: p.core_scores.score,
          grade: p.core_scores.grade,
          band: p.core_scores.band,
          verdict: p.core_scores.verdict ?? null,
          verdict_sublabels: p.core_scores.verdict_sublabels ?? [],
          relative_score: p.core_scores.relative_score ?? null,
          cohort_size: p.core_scores.cohort_size ?? null,
        }
      : null,
    ai_match_score: score,
    ai_health_score: healthScore,
    ai_match_reasons: reasons,
    ai_match_warning: warning,
  };
}

function suggestedRefinements(parsed: ParsedProductQuery): string[] {
  const out: string[] = [];
  if (!parsed.hard_constraints.max_price) out.push("Add a budget, e.g. under ₹150");
  if (!parsed.hard_constraints.max_sugar_g_100g) out.push("Add a sugar limit");
  if (!parsed.health_contexts.length && !parsed.soft_preferences.some((s) => /parents/i.test(s))) {
    out.push("Add a goal like diabetic, kids, gym, or fat loss");
  }
  if (!parsed.hard_constraints.vegetarian && !parsed.hard_constraints.vegan) {
    out.push("Specify vegetarian or vegan if needed");
  }
  return out.slice(0, 3);
}

async function runAiProductSearchPass(
  parseResult: QueryParseResult,
  opts: { limit?: number; prompt?: string; tier?: SearchIntentTier },
): Promise<AiSearchResult> {
  const limit = Math.min(40, Math.max(4, opts.limit ?? 24));
  const parsed = parseResult.parsed;
  const prompt = opts.prompt?.trim() || parsed.explanation;
  const tier = opts.tier ?? "structured";

  const catalog = await getCatalogPoolForParsed(parsed);
  const candidates = retrieveCandidates(catalog, parsed, 120);
  const byId = new Map(candidates.map((p) => [p.id, p]));

  const deterministic = rankCandidatesSemantically(
    candidates,
    parsed,
    Math.min(LLM_CANDIDATE_CAP, Math.max(limit * 2, 24)),
  );
  const rankingsForUi = deterministic.rankings.slice(0, limit);

  let summary = deterministic.summary;
  let rankings = rankingsForUi;
  let usage: QueryParseResult["usage"] = null;
  let rankSource: AiSearchResult["rank_source"] = "semantic";
  let rankWarning: string | undefined;

  const gatedIds = new Set(deterministic.rankings.map((r) => r.product_id));
  const gatedForLlm = deterministic.rankings
    .map((r) => byId.get(r.product_id))
    .filter((p): p is ProductListItem => !!p);

  const useLlmRank = shouldUseLlmRank(
    tier,
    parsed,
    deterministic,
    candidates.length,
    limit,
  );

  if (useLlmRank && gatedForLlm.length > 0) {
    const llm = await rankCandidatesWithDeepseek(prompt, parsed, gatedForLlm, limit);
    usage = llm.usage;
    rankWarning = llm.warning;
    if (llm.rankings.length > 0) {
      summary = llm.summary;
      rankings = mergeDeterministicWithLlmRankings(
        deterministic.rankings,
        llm.rankings,
        gatedIds,
        limit,
        { byId, parsed },
      );
      rankSource = llm.source === "deepseek" ? "deepseek" : "semantic";
    }
  } else if (candidates.length === 0) {
    summary = "No products in the catalog matched your gates — try broadening the request.";
  }

  const items: AiSearchItem[] = [];
  for (const row of rankings) {
    const p = byId.get(row.product_id);
    if (!p) continue;
    items.push(toAiGridItem(p, parsed, row.score, row.reasons, row.warning ?? null));
  }

  return {
    parsed,
    parse_source: parseResult.source,
    rank_source: rankSource,
    intent_tier: tier,
    parse_warning: parseResult.warning,
    rank_warning: rankWarning,
    summary,
    items,
    reasons_by_product_id: Object.fromEntries(
      rankings.map((r) => [r.product_id, r.reasons]),
    ),
    refinements: tier === "complex" ? suggestedRefinements(parsed) : [],
    usage: mergeUsage(parseResult.usage, usage),
    limit,
    total: candidates.length,
    relaxed: deterministic.relaxed,
  };
}

export async function runAiProductSearch(
  parseResult: QueryParseResult,
  opts: { limit?: number; prompt?: string; tier?: SearchIntentTier } = {},
): Promise<AiSearchResult> {
  const requestedTier = opts.tier ?? "structured";
  const first = await runAiProductSearchPass(parseResult, { ...opts, tier: requestedTier });

  if (
    requestedTier === "structured" &&
    first.rank_source === "semantic" &&
    shouldEscalateStructuredToComplex(
      "structured",
      first.items.length,
      first.parsed,
      first.limit,
    )
  ) {
    const escalated = await runAiProductSearchPass(parseResult, {
      ...opts,
      tier: "complex",
    });
    if (
      escalated.items.length > first.items.length ||
      escalated.rank_source !== "semantic"
    ) {
      return { ...escalated, intent_tier: "complex" };
    }
  }

  return first;
}

export { shouldEscalateStructuredToComplex } from "@/lib/search/llm-rank-gate";
