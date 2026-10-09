/** Map a planned-search result onto the AiSearchResult contract used by web and mobile. */
import type { AiSearchItem, AiSearchResult } from "@/lib/search/ai-search";
import type { ParsedProductQuery } from "@/lib/search/query-parse";
import { normalizeProductImageUrls } from "@/lib/products/catalog-hero-image";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import { scoreToBand, scoreToGrade } from "@/lib/search/v2/adapter";
import { CLAIMS, type ClaimId } from "@/lib/facts/vocab";
import type { PlannedSearchItem, PlannedSearchResult } from "./search";

const SORT_LABEL: Partial<Record<string, (it: PlannedSearchItem) => string | null>> = {
  price_inr: it => (it.price_inr != null ? `₹${it.price_inr}` : null),
  price_per_100: it => (it.price_per_100 != null ? `₹${it.price_per_100.toFixed(1)}/100g` : null),
  protein_g: it => (it.nutrition?.protein_g_100g != null ? `Protein ${it.nutrition.protein_g_100g}g/100g` : null),
  sugar_g: it => (it.nutrition?.sugar_g_100g != null ? `Sugar ${it.nutrition.sugar_g_100g}g/100g` : null),
  energy_kcal: it => (it.nutrition?.energy_kcal_100g != null ? `${it.nutrition.energy_kcal_100g} kcal/100g` : null),
  fiber_g: it => (it.nutrition?.fiber_g_100g != null ? `Fibre ${it.nutrition.fiber_g_100g}g/100g` : null),
  sodium_mg: it => (it.nutrition?.sodium_mg_100g != null ? `Sodium ${it.nutrition.sodium_mg_100g}mg/100g` : null),
};

function reasons(it: PlannedSearchItem, r: PlannedSearchResult): string[] {
  const out: string[] = [];
  const sortLabel = SORT_LABEL[r.plan.sort.field]?.(it);
  if (sortLabel) out.push(sortLabel);
  for (const c of r.plan.exclude) {
    if (!it.present.includes(c) && !it.unknown.includes(c) && !it.may_contain.includes(c) && it.ingredient_status === "complete") {
      out.push(`No ${c.replace(/_source$/, "").replace(/_/g, " ")}`);
    }
  }
  for (const c of it.claims) if ((r.plan.claims_preferred as string[]).includes(c)) out.push(CLAIMS[c as ClaimId]);
  if (it.why && it.verdict === "good") out.push(it.why);
  return [...new Set(out)].slice(0, 4);
}

function warning(it: PlannedSearchItem): string | null {
  if (it.confirmation === "unconfirmed") return `Unconfirmed: ${it.notes.find(n => !n.startsWith("relaxed")) ?? "label incomplete"}`;
  const mayContain = it.notes.find(n => n.startsWith("may contain"));
  if (mayContain) return mayContain[0]!.toUpperCase() + mayContain.slice(1);
  if (it.relaxed) return it.notes.find(n => n.startsWith("relaxed"))?.replace("relaxed", "Outside your") ?? null;
  if (it.conflicts.length) return "Label claim conflicts with ingredients — check pack";
  return null;
}

function toItem(it: PlannedSearchItem, r: PlannedSearchResult): AiSearchItem {
  const scout = it.scout_score;
  const images = normalizeProductImageUrls(it.display.image_urls, { ocrImageUrl: it.display.ocr_image_url });
  const complete = it.ingredient_status === "complete";
  const free = (c: string) => (it.present.includes(c) ? false : complete && !it.unknown.includes(c) ? true : null);
  const num = (k: string) => (it.nutrition?.[k] == null ? null : Number(it.nutrition[k]));
  return {
    id: it.product_id, slug: it.slug, name: it.name, brand: it.brand,
    category: it.category, subcategory: it.subcategory, primary_type: it.display.primary_type,
    net_weight: it.net_weight, price_inr: it.price_inr, mrp_inr: it.display.mrp_inr,
    image_urls: images.slice(0, 1),
    core_scores: scout != null ? {
      score: scout, grade: scoreToGrade(scout), band: scoreToBand(scout),
      verdict: resolveProductVerdict({ score: scout, name: it.name, category: it.category, subcategory: it.subcategory }),
      verdict_sublabels: [], relative_score: null, cohort_size: null,
      absolute_score: it.display.absolute_score, category_rank: it.display.category_rank,
      category_size: it.display.category_size, category_label: it.display.category_label,
    } : null,
    ai_match_score: Math.round(Math.max(0, Math.min(1, it.score)) * 100),
    ai_health_score: scout ?? undefined,
    ai_match_reasons: reasons(it, r),
    ai_match_warning: warning(it),
    sugar_g: num("sugar_g_100g"), protein_g: num("protein_g_100g"),
    fat_g: num("fat_g_100g"), fiber_g: num("fiber_g_100g"),
    is_vegan: it.vegan, is_gluten_free: free("gluten_source"), is_palm_oil_free: free("palm_oil"),
    has_added_sugar: it.present.includes("added_sugar") ? true : complete && !it.unknown.includes("added_sugar") ? false : null,
    display_chips: [],
  };
}

export function plannedToAiResult(r: PlannedSearchResult, limit: number): AiSearchResult {
  // Strict (allergy) searches never mix unconfirmed products into results.
  const showUnconfirmed = !r.plan.strict && r.items.length < limit;
  const extra = showUnconfirmed ? r.unconfirmed.slice(0, Math.min(6, limit - r.items.length)) : [];
  const items = [...r.items, ...extra].map(it => toItem(it, r));
  const sortIntent = (({ price_inr: "cheapest", scout_score: "healthiest", protein_g: "highest_protein" }) as Record<string, ParsedProductQuery["sort_intent"]>)[r.plan.sort.field] ?? "best_match";
  const parsed: ParsedProductQuery = {
    product_terms: [], search_keywords: [], exclude_keywords: [], categories: [],
    hard_constraints: {}, soft_preferences: [], health_contexts: [],
    sort_intent: sortIntent, explanation: r.summary,
  };
  const relaxNotes = r.relaxed.map(k => `Loosened ${k.replace("numeric:", "").replace(/_/g, " ")} to find more matches`);
  let summary = r.summary;
  if (r.plan.strict && !r.items.length && r.unconfirmed.length) {
    summary = "No product's label confirms it is safe for this request. Products with incomplete labels are not shown.";
  }
  return {
    parsed, parse_source: "deepseek", rank_source: "decision",
    intent_tier: r.plan.intent === "goal" || r.plan.intent === "comparison" ? "complex" : "structured",
    parse_warning: r.dropped.includes("planner:degraded") ? "Limited understanding right now — showing closest matches" : undefined,
    summary, items,
    reasons_by_product_id: Object.fromEntries(items.map(i => [i.id, i.ai_match_reasons])),
    refinements: [], relaxation_explanations: relaxNotes, limit, total: items.length,
    relaxed: r.relaxed.length > 0,
    v2: { goal_id: null, goal_phrase: r.plan.judge[0] ?? null, llm_calls: r.llm.calls, latency_ms: r.timings.total_ms },
  };
}
