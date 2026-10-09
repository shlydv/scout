/**
 * Words stripped from catalog SQL ILIKE — modifiers and constraints, not product names.
 * Keeps "ice cream", "protein powder", "soft drinks" when those are the product tokens.
 */
const CATALOG_ILIKE_STOPWORDS = new Set([
  "healthy",
  "healthiest",
  "healthier",
  "organic",
  "natural",
  "nutritious",
  "wholesome",
  "clean",
  "cleaner",
  "cleanest",
  "best",
  "better",
  "good",
  "cheapest",
  "budget",
  "friendly",
  "low",
  "high",
  "less",
  "more",
  "no",
  "without",
  "zero",
  "under",
  "below",
  "over",
  "above",
  "max",
  "min",
  "sugar",
  "sugars",
  "free",
  "added",
  "protein",
  "fat",
  "sodium",
  "salt",
  "fibre",
  "fiber",
  "calorie",
  "calories",
  "kcal",
  "carb",
  "carbs",
  "preservative",
  "preservatives",
  "additive",
  "additives",
  "artificial",
  "palm",
  "oil",
  "maida",
  "gluten",
  "dairy",
  "vegan",
  "vegetarian",
  "veg",
  "keto",
  "diabetic",
  "diabetes",
  "pcos",
  "gym",
  "kids",
  "children",
  "bulking",
  "bulk",
  "gain",
  "weight",
  "loss",
  "diet",
  "dieting",
  "food",
  "foods",
  "snack",
  "snacks",
  "meal",
  "meals",
  "with",
  "and",
  "for",
  "the",
  "or",
  "of",
  "in",
  "on",
  "rs",
  "inr",
  "rupees",
]);

/**
 * Catalog SQL search uses ILIKE on name/brand. Multi-word queries like "healthy noodles"
 * must not require the exact phrase — strip modifiers and keep product tokens.
 */
export function catalogSearchIlikeTerm(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return null;

  const productish = tokens.filter((t) => !CATALOG_ILIKE_STOPWORDS.has(t));
  const use = productish.length ? productish : tokens;
  const term = use.join(" ").replace(/[%_]/g, "").trim();
  return term || null;
}
