/** Compatibility entry point shared by web/mobile search and saved-search alerts. */
import type { AiSearchPreferences } from "@/lib/search/ai-usage";
import { retrieveEvidence } from "@/lib/search/decision/retrieval";
import { evaluateCandidates } from "@/lib/search/decision/evaluate";
import { singleFlight } from "@/lib/search/decision/single-flight";
import { searchInputSchema } from "@/lib/search/decision/input";
import type { SearchV2Result } from "./types";

async function executeSearch(rawQuery: string, opts: { limit?: number; preferences?: AiSearchPreferences | null } = {}): Promise<SearchV2Result> {
  const started = Date.now();
  const limit = Math.max(1, Math.min(24, Math.floor(opts.limit ?? 24)));
  const candidates = await retrieveEvidence(rawQuery, 24);
  const result = await evaluateCandidates(rawQuery, opts.preferences ?? null, candidates);
  const items = result.items.slice(0, limit);
  if (process.env.SEARCH_TELEMETRY === "1") console.log(JSON.stringify({
    type: "decision_search", candidates: candidates.length, matches: result.items.length,
    calls: result.calls, input_tokens: result.inputTokens, latency_ms: Date.now() - started,
  }));
  return {
    intent: { raw_query: rawQuery, kind: "directed", intent_source: "cloudflare", confidence: 1,
      goal_phrase: null, goal_id: null, brand: null, primary_type: null, use_case: null,
      required_flavours: [], modifiers: [], constraints: { avoid_ingredients: [], allergens_excluded: [] },
      constraint_priorities: [], sort: result.sort, comparison_ref: null, comparison_mode: null },
    candidates_total: candidates.length, items, relaxed: false, relaxation_steps: [],
    rank_source: "decision", summary: items.length
      ? `Found ${items.length} matches among ${candidates.length} candidates evaluated against your request.`
      : "No confirmed matches in the evaluated candidates. Try rephrasing your request; your requirements were not relaxed.",
    llm_calls: result.calls, latency_ms: Date.now() - started, explored: false,
    snapshotIndex: candidates.map(c => c.row), dietary_prevalence: {},
    decision: { model: "clef-flash", input_tokens: result.inputTokens, evaluated: candidates.length },
  };
}

const coalesce = singleFlight<SearchV2Result>();
export function runSearchV2(rawQuery: string, opts: { limit?: number; preferences?: AiSearchPreferences | null } = {}): Promise<SearchV2Result> {
  const input = searchInputSchema.parse({ prompt: rawQuery, ...opts });
  const preferences = input.preferences ? {
    diet: input.preferences.diet ?? undefined,
    budget: input.preferences.budget ?? undefined,
    healthContexts: [...(input.preferences.healthContexts ?? [])].sort(),
    avoidIngredients: [...(input.preferences.avoidIngredients ?? [])].sort(),
  } : null;
  const key = JSON.stringify([input.prompt, input.limit ?? 24, preferences]);
  return coalesce(key, () => executeSearch(input.prompt, { limit: input.limit, preferences }));
}
