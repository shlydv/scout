/**
 * Shape planned-search results for the web UI: one card per product (with its
 * pack sizes), plan chips that say what Scout understood, plain-language notes
 * for relaxed constraints, and a separate unconfirmed list.
 */
import { normalizeProductImageUrls } from "@/lib/products/catalog-hero-image";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import type { VerdictId } from "@/lib/scoring/verdict";
import { CLAIMS, CONCEPT_LABELS, NUMERIC_LABELS, type ClaimId, type ConceptId, type NumericField } from "@/lib/facts/vocab";
import type { SearchPlan } from "./plan";
import type { PlannedSearchItem, PlannedSearchResult } from "./search";

export type SearchCard = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  price_inr: number | null;
  mrp_inr: number | null;
  net_weight: string | null;
  price_per_100: number | null;
  score: number | null;
  verdict: VerdictId | null;
  rank: { rank: number; size: number; label: string | null } | null;
  reasons: string[];
  warning: string | null;
  fit: "good" | "ok" | null;
  sizes: { slug: string; net_weight: string | null; price_inr: number | null }[];
  nutrition: { protein_g: number | null; sugar_g: number | null; kcal: number | null };
};

export type SearchResponse = {
  query: string;
  summary: string;
  intent: SearchPlan["intent"];
  chips: string[];
  notes: string[];
  strict: boolean;
  degraded: boolean;
  items: SearchCard[];
  unconfirmed: SearchCard[];
  timings: PlannedSearchResult["timings"];
};

const SORT_CHIP: Partial<Record<NumericField, [string, string]>> = {
  price_inr: ["Cheapest first", "Priciest first"], price_per_100: ["Best value first", "Priciest per 100g first"],
  scout_score: ["Lowest score first", "Healthiest first"], protein_g: ["Least protein first", "Most protein first"],
  protein_per_100kcal: ["Least protein per kcal first", "Most protein per kcal first"], sugar_g: ["Lowest sugar first", "Most sugar first"],
  energy_kcal: ["Lowest calories first", "Most calories first"], sodium_mg: ["Lowest sodium first", "Most sodium first"],
  fiber_g: ["Least fibre first", "Most fibre first"], fat_g: ["Lowest fat first", "Most fat first"],
};

function numericChip(n: SearchPlan["numeric"][number]): string {
  const { label, unit } = NUMERIC_LABELS[n.field];
  if (n.field === "price_inr") return n.op.startsWith("<") ? `Under ₹${n.value}` : `Over ₹${n.value}`;
  const op = n.op === "<=" ? "≤" : n.op === ">=" ? "≥" : n.op;
  const per = n.field === "scout_score" || n.field === "protein_per_100kcal" || n.field === "price_per_100" ? "" : "/100g";
  return unit === "₹" ? `${label} ${op} ₹${n.value}` : `${label} ${op} ${n.value}${unit}${per}`;
}

export function planChips(plan: SearchPlan, reference: PlannedSearchResult["reference"]): string[] {
  const chips: string[] = [];
  if (plan.brands.length) chips.push(plan.brands.join(" / "));
  const types = plan.l3.map(q => q.split(" > ").at(-1)!);
  const scope = types.length && types.length <= 3 ? types : plan.subcategories.length && plan.subcategories.length <= 3 ? plan.subcategories : plan.categories.length <= 2 ? plan.categories : [];
  if (scope.length) chips.push([...new Set(scope)].join(", "));
  for (const t of plan.name_terms) chips.push(`“${t.split("|")[0]}”`);
  for (const c of plan.exclude) chips.push(`No ${CONCEPT_LABELS[c as ConceptId]}`);
  for (const c of plan.require) chips.push(`With ${CONCEPT_LABELS[c as ConceptId]}`);
  for (const c of plan.claims_required) chips.push(CLAIMS[c as ClaimId].split(" / ")[0]!);
  if (plan.diet.vegan) chips.push("Vegan");
  else if (plan.diet.veg) chips.push("Vegetarian");
  if (plan.diet.jain) chips.push("Jain");
  if (plan.strict) chips.push("Allergy-strict");
  for (const n of plan.numeric) chips.push(numericChip(n));
  if (plan.comparison && reference) {
    const word = plan.comparison.field === "scout_score" ? (plan.comparison.dir === "higher" ? "Healthier" : "Less healthy")
      : plan.comparison.field === "price_inr" ? (plan.comparison.dir === "lower" ? "Cheaper" : "Pricier")
        : `${plan.comparison.dir === "higher" ? "More" : "Less"} ${NUMERIC_LABELS[plan.comparison.field].label.toLowerCase()}`;
    chips.push(`${word} than ${plan.comparison.reference}`);
  }
  if (plan.sort.field !== "relevance") {
    const pair = SORT_CHIP[plan.sort.field];
    if (pair) chips.push(plan.sort.dir === "asc" ? pair[0] : pair[1]);
  }
  return chips.slice(0, 8);
}

export function relaxNote(key: string, plan: SearchPlan): string {
  if (key === "scope") return "Few exact matches, so related categories are included";
  if (key === "name_terms") return `No exact “${plan.name_terms.map(t => t.split("|")[0]).join(", ")}” match — showing close alternatives`;
  if (key === "brands") return `Few ${plan.brands.join(" / ")} matches — other brands follow`;
  if (key === "claims_required") return "Few packs state the requested claim — others follow";
  if (key.startsWith("numeric:")) {
    const n = plan.numeric.find(x => x.field === key.slice(8));
    if (n?.field === "price_inr") return `Few matches under ₹${n.value} — slightly pricier options follow`;
    return n ? `Few matches for ${numericChip(n)} — near misses follow` : "Some limits were loosened";
  }
  return "Some limits were loosened";
}

const SORT_REASON: Partial<Record<NumericField, (it: PlannedSearchItem) => string | null>> = {
  price_per_100: it => (it.price_per_100 != null ? `₹${it.price_per_100.toFixed(1)}/100g` : null),
  protein_g: it => (it.nutrition?.protein_g_100g != null ? `${it.nutrition.protein_g_100g}g protein/100g` : null),
  protein_per_100kcal: it => (it.nutrition?.protein_g_100g != null ? `${it.nutrition.protein_g_100g}g protein/100g` : null),
  sugar_g: it => (it.nutrition?.sugar_g_100g != null ? `${it.nutrition.sugar_g_100g}g sugar/100g` : null),
  energy_kcal: it => (it.nutrition?.energy_kcal_100g != null ? `${it.nutrition.energy_kcal_100g} kcal/100g` : null),
  fiber_g: it => (it.nutrition?.fiber_g_100g != null ? `${it.nutrition.fiber_g_100g}g fibre/100g` : null),
  sodium_mg: it => (it.nutrition?.sodium_mg_100g != null ? `${it.nutrition.sodium_mg_100g}mg sodium/100g` : null),
};

const CLAIM_CHIP: Partial<Record<ClaimId, string>> = {
  no_preservatives: "No preservatives", high_protein: "High protein", high_fibre: "High fibre",
  baked_not_fried: "Baked, not fried", whole_grain: "Whole grain", kids: "For kids", diabetic_friendly: "Diabetic friendly",
};

function reasons(it: PlannedSearchItem, plan: SearchPlan): string[] {
  const out: string[] = [];
  const sortReason = SORT_REASON[plan.sort.field as NumericField]?.(it);
  if (sortReason) out.push(sortReason);
  if (it.ingredient_status === "complete") {
    for (const c of plan.exclude) {
      if (!it.present.includes(c) && !it.unknown.includes(c) && !it.may_contain.includes(c)) out.push(`No ${CONCEPT_LABELS[c]}`);
    }
  }
  for (const c of it.claims as ClaimId[]) {
    if ((plan.claims_preferred as string[]).includes(c) || (plan.claims_required as string[]).includes(c)) {
      out.push(CLAIM_CHIP[c] ?? CLAIMS[c].split(" / ")[0]!);
    }
  }
  if (it.verdict === "good" && it.why) out.push(it.why);
  return [...new Set(out)].slice(0, 3);
}

function warning(it: PlannedSearchItem, plan: SearchPlan): string | null {
  if (it.confirmation === "unconfirmed") {
    const note = it.notes.find(n => !n.startsWith("relaxed"));
    return note ? `Label doesn't confirm: ${note.replace(/^label doesn't confirm /, "")}` : "Label incomplete";
  }
  const mayContain = it.notes.find(n => n.startsWith("may contain"));
  if (mayContain) return mayContain[0]!.toUpperCase() + mayContain.slice(1);
  const relaxed = it.notes.find(n => n.startsWith("relaxed "));
  if (relaxed) {
    const key = relaxed.slice(8);
    if (key === "scope") return "From a related category";
    if (key === "brands") return "Different brand";
    if (key === "name_terms") return "Close alternative";
    const n = plan.numeric.find(x => x.field === key);
    if (n?.field === "price_inr") return `Above ₹${n.value}`;
    return n ? `Outside ${numericChip(n)}` : "Near miss";
  }
  if (it.conflicts.some(c => !c.startsWith("ingredient list incomplete"))) return "Pack claim conflicts with ingredients";
  return null;
}

export function toCard(it: PlannedSearchItem, plan: SearchPlan): SearchCard {
  const images = normalizeProductImageUrls(it.display.image_urls, { ocrImageUrl: it.display.ocr_image_url });
  const num = (k: string) => (it.nutrition?.[k] == null ? null : Number(it.nutrition[k]));
  return {
    id: it.product_id, slug: it.slug, name: it.name, brand: it.brand, image: images[0] ?? null,
    price_inr: it.price_inr, mrp_inr: it.display.mrp_inr, net_weight: it.net_weight, price_per_100: it.price_per_100,
    score: it.scout_score,
    verdict: it.scout_score == null ? null : resolveProductVerdict({ score: it.scout_score, name: it.name, category: it.category, subcategory: it.subcategory }),
    rank: it.display.category_rank && it.display.category_size
      ? { rank: it.display.category_rank, size: it.display.category_size, label: it.display.category_label }
      : null,
    reasons: reasons(it, plan), warning: warning(it, plan),
    fit: it.verdict === "good" || it.verdict === "ok" ? it.verdict : null,
    sizes: (it.sizes ?? []).map(s => ({ slug: s.slug, net_weight: s.net_weight, price_inr: s.price_inr })),
    nutrition: { protein_g: num("protein_g_100g"), sugar_g: num("sugar_g_100g"), kcal: num("energy_kcal_100g") },
  };
}

export function presentSearch(r: PlannedSearchResult): SearchResponse {
  let summary = r.summary;
  if (r.plan.strict && !r.items.length && r.unconfirmed.length) {
    summary = "No product's label confirms it is safe for this request. Products with incomplete labels are not shown.";
  }
  return {
    query: r.query, summary, intent: r.plan.intent,
    chips: r.plan.intent === "non_food" || r.plan.intent === "unclear" ? [] : planChips(r.plan, r.reference),
    notes: [...new Set(r.relaxed.map(k => relaxNote(k, r.plan)))],
    strict: r.plan.strict, degraded: r.dropped.includes("planner:degraded"),
    items: r.items.map(it => toCard(it, r.plan)),
    // Strict (allergy) searches never surface unconfirmed products.
    unconfirmed: r.plan.strict ? [] : r.unconfirmed.slice(0, 8).map(it => toCard(it, r.plan)),
    timings: r.timings,
  };
}
