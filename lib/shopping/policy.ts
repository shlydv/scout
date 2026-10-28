import { CONCEPT_LABELS, type ConceptId } from "@/lib/facts/vocab";
import type { Preferences, SearchPlan } from "@/lib/search/planned/plan";

/** Model output may add constraints, but cannot remove these explicit requirements. */
export function preserveRequirements(plan: SearchPlan, query: string, preferences: Preferences = null): SearchPlan {
  const text = `${query} ${preferences?.diet ?? ""} ${(preferences?.avoidIngredients ?? []).join(" free ")} ${(preferences?.healthContexts ?? []).join(" ")}`.toLowerCase();
  const exclude = new Set(plan.exclude);
  const allergens: [ConceptId, string][] = [["gluten_source", "gluten"], ["wheat", "wheat"], ["dairy", "milk|dairy|lactose"], ["egg", "eggs?"], ["peanut", "peanuts?|groundnuts?"], ["tree_nut", "tree nuts?|almonds?|cashews?|walnuts?"], ["soy", "soy|soya"], ["sesame", "sesame"], ["mustard", "mustard"], ["fish_seafood", "fish|shellfish|seafood"], ["sulphite", "sulphites?|sulfites?"]];
  for (const [concept, names] of allergens) {
    const pattern = new RegExp(`\\b(?:${names})[ -]?(?:free|allerg)|\\b(?:no|without|avoid|allergic to)\\s+(?:${names})\\b`, "i");
    if (pattern.test(text)) exclude.add(concept);
  }
  if (/gluten[ -]?free|celiac|coeliac/.test(text)) exclude.add("gluten_source");
  if (/peanut[ -]?(free|allerg)|allerg\w*\s+to\s+peanuts?/.test(text)) exclude.add("peanut");
  if (/\bnuts?[ -]?free\b|\bnuts? allerg/.test(text)) { exclude.add("peanut"); exclude.add("tree_nut"); }
  if (/(dairy|lactose)[ -]?free/.test(text)) exclude.add("dairy");
  if (/egg[ -]?free|eggless/.test(text)) exclude.add("egg");
  for (const ingredient of preferences?.avoidIngredients ?? []) {
    const normalized = ingredient.toLowerCase().trim().replace(/_/g, " ");
    const aliases: Record<string, ConceptId> = { milk: "dairy", gluten: "gluten_source", nuts: "tree_nut", maida: "refined_flour", sugar: "added_sugar", "palm oil": "palm_oil" };
    const concept = aliases[normalized] ?? (Object.entries(CONCEPT_LABELS).find(([id, label]) => id.replace(/_/g, " ") === normalized || label === normalized)?.[0] as ConceptId | undefined);
    if (concept) exclude.add(concept);
    if (normalized === "nuts" || normalized === "nut") { exclude.add("peanut"); exclude.add("tree_nut"); }
  }
  const diet = { ...plan.diet };
  if (/\bvegan\b/.test(text)) diet.vegan = true;
  if (/\bvegetarian\b|\bveg only\b/.test(text)) diet.veg = true;
  if (/\bjain\b/.test(text)) diet.jain = true;
  if (preferences?.diet === "veg") diet.veg = true;
  const judge = [...new Set([...plan.judge, ...(preferences?.healthContexts ?? []).map(h => `Suitable for ${h}`), ...(preferences?.avoidIngredients ?? []).map(i => `Must avoid ${i}`)])];
  const strict = plan.strict || /allerg|celiac|coeliac|anaphyla/.test(text);
  return { ...plan, diet, judge, strict, exclude: [...exclude] };
}

export function sensitiveRequest(plan: SearchPlan, query = ""): boolean {
  return plan.strict || plan.exclude.length > 0 || plan.claims_required.length > 0 || Object.values(plan.diet).some(Boolean)
    || plan.intent === "goal" || plan.judge.length > 0
    || plan.numeric.some(n => !["price_inr", "price_per_100", "pack_qty", "scout_score"].includes(n.field))
    || /allerg|celiac|coeliac|anaphyla|diabet|blood sugar|blood pressure|hypertens|kidney|renal|heart|pregnan|medical|\bBP\b/i.test(query);
}

/** Nutrition/claim requirements for sensitive requests are never relaxable. */
export function lockRequirements(plan: SearchPlan, query: string): SearchPlan {
  if (!sensitiveRequest(plan, query)) return plan;
  return { ...plan, relax: plan.relax.filter(k => k === "scope" || k === "brands" || k === "name_terms") };
}
