export type ConcernSeverity = "none" | "low" | "medium" | "high";

/** Yuka-style additive tier. Sets the per-ingredient penalty. */
export type AdditiveTier = "risk-free" | "limited" | "moderate" | "hazardous";

export type Grade = "A" | "B" | "C" | "D" | "F";

/** Yuka-style 4-tier presentation band, derived from the 0–100 score. */
export type ScoreBand = "bad" | "poor" | "good" | "excellent";

export interface Product {
  id: string;
  /** Retailer variant id; rows without one use product_key. */
  zepto_sku: string | null;
  product_key?: string | null;
  data_source?: string | null;
  slug: string;
  name: string;
  brand: string | null;
  super_category: string | null;
  category: string | null;
  subcategory: string | null;
  /** Zepto L3 / use-case category. */
  l3_category?: string | null;
  net_weight: string | null;
  price_inr: number | null;
  mrp_inr: number | null;
  image_urls: string[];
  product_url: string | null;
  barcode: string | null;
  ingredients_raw: string | null;
  nutrition: ProductNutrition | null;
  /**
   * Free-form key/value attributes from the source platform's PDP — Diet Preference,
   * Country of Origin, Shelf Life, FSSAI License, Allergen Information, Type,
   * Flavour, Description, Key Features, Seller, etc. Used for product detail UI
   * and as soft scoring context for claims, diet labels, and processing signals.
   */
  attributes: Record<string, string> | null;
  raw_payload: Record<string, unknown> | null;
  catalog_visible?: boolean;
  scraped_at: string;
  updated_at: string;
}

/** Normalized per-100g nutrition. All fields optional — some products only report a subset. */
export interface ProductNutrition {
  energy_kcal_100g?: number;
  protein_g_100g?: number;
  fat_g_100g?: number;
  saturated_fat_g_100g?: number;
  trans_fat_g_100g?: number;
  carbs_g_100g?: number;
  sugar_g_100g?: number;
  added_sugar_g_100g?: number;
  fiber_g_100g?: number;
  sodium_mg_100g?: number;
  calcium_mg_100g?: number;
  iron_mg_100g?: number;
  caffeine_mg_100g?: number;
  potassium_mg_100g?: number;
  cholesterol_mg_100g?: number;
  /** Explicit volume-based label values; never interpreted as grams. */
  energy_kcal_100ml?: number;
  protein_g_100ml?: number;
  fat_g_100ml?: number;
  saturated_fat_g_100ml?: number;
  trans_fat_g_100ml?: number;
  carbs_g_100ml?: number;
  sugar_g_100ml?: number;
  added_sugar_g_100ml?: number;
  fiber_g_100ml?: number;
  sodium_mg_100ml?: number;
  calcium_mg_100ml?: number;
  iron_mg_100ml?: number;
  caffeine_mg_100ml?: number;
  potassium_mg_100ml?: number;
  cholesterol_mg_100ml?: number;
  /** Free-form, e.g. when a value didn't fit the schema. */
  extra?: Record<string, number | string | null>;
  /** Where the values came from.
   *  - "platform" → from the grocery platform's structured API (e.g. Blinkit's PDP fields)
   *  - "label"    → from the printed back-label text (after OCR + light cleanup)
   *  - "ocr"      → from raw OCR text (no human/LLM cleanup)
   *  - "off"      → from Open Food Facts
   */
  source?: "platform" | "label" | "ocr" | "off" | "llm_text";
}

export interface ZeptoTaxonomy {
  id: string;
  super_category: string | null;
  category: string | null;
  subcategory: string | null;
  product_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface CategoryBaseline {
  id: string;
  category: string;
  subcategory: string | null;
  floor_score: number;
  ceiling_score: number;
  /** Map of nutrient key (e.g. "protein_g_100g") → signed weight in [-1, 1].
   *  Positive = higher value is better, negative = higher value is worse.
   *  Weights inside one baseline don't need to sum to 1 — they're rescaled at scoring time. */
  nutrients: Record<string, number>;
  priority: number;
  source: "curated" | "llm" | "default";
  notes: string | null;
}

export interface Ingredient {
  id: string;
  name_normalized: string;
  name_display: string;
  name_raw_variants: string[];
  e_number: string | null;
  category: string | null;
  off_id: string | null;
  created_at: string;
}

export interface IngredientConcern {
  id: string;
  ingredient_id: string;
  concern_type: string;
  severity: ConcernSeverity;
  why: string | null;
  evidence_url: string | null;
  source: string | null;
  created_at: string;
}

export type VerdictId = "daily_staple" | "good_choice" | "occasional_treat" | "skip";

export type RoleCohort = "staple" | "snack" | "treat" | "meal_replacement" | "adjunct";

export interface IngredientIntelligence {
  normalized_name: string;
  display_name: string | null;
  nova_class: number | null;
  role: string | null;
  concern_tier: "innocuous" | "watchful" | "problematic" | "hazardous";
  concern_reasons: string[];
  intrinsic_quality: number | null;
  synonyms: string[];
  model: string | null;
  rated_at: string;
}

export interface CoreScore {
  product_id: string;
  score: number;
  grade: Grade;
  band: ScoreBand;
  subscores: SubScores;
  concerns: ConcernEntry[];
  breakdown: ScoreBreakdown;
  rule_version: number;
  computed_at: string;
  /** V9 fields (nullable until backfill) */
  absolute_score?: number | null;
  relative_score?: number | null;
  verdict?: VerdictId | null;
  verdict_sublabels?: string[];
  role_cohort?: RoleCohort | null;
  serving_g_effective?: number | null;
  cohort_id?: string | null;
  cohort_size?: number | null;
  /** v10 LLM editorial verdict — prose only, cached per rule_version. */
  opinion?: ProductOpinionRow | null;
  /** Part B: rank within the product's real peer group on the clean Zepto taxonomy
   *  (l3 when the cohort is big enough, else subcategory), by absolute_score. Drives
   *  the "Top X% in category" signal — replaces the noisy v9 relative percentile. */
  category_rank?: number | null;
  category_size?: number | null;
  category_label?: string | null;
}

export interface ProductOpinionRow {
  headline: string;
  why: string;
  caveat?: string | null;
  tone: "honest" | "enthusiastic" | "skeptical" | "dismissive";
  model: string;
  rule_version: number;
  generated_at: string;
}

/** Yuka-style decomposition. Each value is on its own scale and summed to 100. */
export interface SubScores {
  /** Nutrition: 0–60. Category-anchored, then rank-normalized inside the subcategory. */
  nutrition: number;
  /** Additives: 0–30. Starts at 30, additive penalties subtract. */
  additives: number;
  /** Labels: 0–10. Bonus for verified labels (India Organic, Jaivik Bharat, no palm oil, etc.). */
  labels: number;
}

export interface ConcernEntry {
  ingredient: string;
  tier: AdditiveTier;
  severity: ConcernSeverity;
  why: string;
  source: string;
  evidence_url?: string;
}

export interface ScoreBreakdown {
  category: string | null;
  subcategory: string | null;
  category_band: [number, number] | null;
  nutrition_rank: number | null;
  /** True if a hazardous-tier additive forced the global hard cap. */
  hard_capped: boolean;
  notes: string[];
}
