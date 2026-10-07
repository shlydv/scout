/** Search V2 types — SEARCH_V2_PLAN.md (LLM-first) */

export const TRAIT_IDS = [
  "protein_density",
  "fiber_density",
  "low_sugar",
  "low_sodium",
  "low_fat",
  "low_saturated_fat",
  "healthy_fats",
  "low_calorie_density",
  "low_carb",
  "whole_food",
  "hydration",
  "electrolytes",
  "satiety",
  "gut_health",
  "slow_energy",
  "quick_energy",
  "antioxidant",
  "vitamin_rich",
  "calcium_rich",
  "iron_rich",
  "processing_level",
  "clean_label",
  "no_added_sugar",
  "low_gi",
  "kid_friendly",
  "diabetic_friendly",
  "gym_friendly",
  "elderly_friendly",
  "no_artificial_sweetener",
] as const;

export type TraitId = (typeof TRAIT_IDS)[number];

export type TraitVector = Partial<Record<TraitId, number>>;
export type TraitSourceMap = Partial<Record<TraitId, "math" | "llm">>;
export type TraitConfidenceMap = Partial<Record<TraitId, number>>;
export type TraitReasonMap = Partial<Record<TraitId, string>>;

export type NutritionTier = "low" | "medium" | "high" | "unknown";

/** Default for Voyage voyage-multilingual-2 — override via EMBEDDING_DIM env */
export const EMBEDDING_DIM = 1024;

export type ProductSearchIndexRow = {
  product_id: string;
  canonical_product_id: string | null;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  l3_category: string | null;
  primary_type: string | null;
  base_name: string | null;
  form: string | null;
  flavours: string[];
  variants: string[];
  is_veg: boolean | null;
  is_vegan: boolean | null;
  is_gluten_free: boolean | null;
  is_jain: boolean | null;
  is_palm_oil_free: boolean | null;
  has_added_sugar: boolean | null;
  allergens: string[];
  claims: string[];
  sugar_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  saturated_fat_g?: number | null;
  calcium_mg?: number | null;
  iron_mg?: number | null;
  fiber_g?: number | null;
  carbs_g?: number | null;
  sodium_mg: number | null;
  energy_kcal: number | null;
  total_protein_g: number | null;
  total_sugar_g: number | null;
  total_fat_g: number | null;
  total_calories: number | null;
  price_inr: number | null;
  sugar_tier: NutritionTier | null;
  protein_tier: NutritionTier | null;
  fat_tier: NutritionTier | null;
  traits: TraitVector;
  trait_source: TraitSourceMap;
  trait_confidence: TraitConfidenceMap;
  trait_reasons: TraitReasonMap;
  scout_score: number | null;
  /** Part B: consistent absolute health score + clean-taxonomy category rank, for the
   *  tier + "Top X% in category" card display. Populated by sync-category-rank.ts. */
  absolute_score?: number | null;
  category_rank?: number | null;
  category_size?: number | null;
  category_label?: string | null;
  nova_group: number | null;
  data_quality_score: number;
  data_completeness: number;
  facet_confidence: Record<string, number>;
  brand_tier: string | null;
  pack_size_value: number | null;
  pack_size_unit: string | null;
  use_cases: string[];
  search_doc: string | null;
  embedding: number[] | null;
  type_embedding: number[] | null;
  /** Cosine distance to the query embedding, computed in-DB by the search_v2_ids RPC.
   *  Present on pgvector-fetched rows (which omit raw vectors to keep egress ~3KB/row). */
  knn_distance?: number | null;
  click_count: number;
  save_count: number;
  last_interaction_at: string | null;
  built_at: string | null;
  source_hash: string | null;
};

/** Per-primary-type prevalence of dietary attributes (0-1). Used by getDisplayChips()
 *  to suppress non-differentiating badges (≥80% prevalence → hidden unless cohort < 5). */
export type DietaryPrevalenceMap = Record<
  string,
  { total: number; is_vegan: number; is_gluten_free: number; is_palm_oil_free: number; is_jain: number }
>;

export type GoalTraitWeights = Partial<Record<TraitId, number>>;

export type GoalTraitMapRow = {
  goal_id: string;
  goal_phrase: string;
  display_name: string;
  trait_weights: GoalTraitWeights;
  goal_embedding: number[] | null;
  source: string;
  confidence: number;
  support_count: number;
};

export type CategoryTraitProfileRow = {
  category_key: string;
  category: string | null;
  subcategory: string | null;
  trait_means: TraitVector;
  trait_centroid: number[] | null;
  product_count: number;
};

export type SearchIntentKind = "directed" | "goal" | "brand" | "ambiguous";

export type ConstraintPriority = {
  field: string;
  priority: number;
};

export type SearchIntentV2 = {
  kind: SearchIntentKind;
  goal_phrase: string | null;
  goal_id: string | null;
  brand: string | null;
  primary_type: string | null;
  /** Resolved Zepto taxonomy grounding — the CLEAN category signal retrieval is
   *  constrained by (vs the fragmented 1,999-value primary_type). Subcategory when
   *  confident; categories is the wider fallback used when subcategory is ambiguous. */
  facet_subcategories?: string[];
  facet_categories?: string[];
  /** LLM-extracted use case (e.g. pre_workout, school_lunch) — §14 */
  use_case: string | null;
  required_flavours: string[];
  modifiers: string[];
  constraints: {
    max_sugar_g?: number;
    max_fat_g?: number;
    max_calories?: number;
    min_protein_g?: number;
    max_price?: number;
    vegan?: boolean;
    vegetarian?: boolean;
    gluten_free?: boolean;
    palm_oil_free?: boolean;
    avoid_ingredients: string[];
    allergens_excluded: string[];
  };
  constraint_priorities: ConstraintPriority[];
  sort: "best_match" | "cheapest" | "healthiest" | "highest_protein" | "lowest_sugar";
  comparison_ref: string | null;
  comparison_mode: "healthier_than" | "cheaper_than" | null;
  confidence: number;
  intent_source: "cloudflare" | "fast-path" | "llm-groq" | "llm-deepseek" | "cache" | "degraded";
  raw_query: string;
  /** LLM-computed trait weights (28 traits → 0-1) — bypasses separate goal decomposition call */
  trait_weights?: Partial<Record<TraitId, number>>;
};

export type RankedCandidate = {
  row: ProductSearchIndexRow;
  relevance_score: number;
  health_score: number;
  trait_match_score: number;
  popularity_score: number;
  final_score: number;
  goal_fit: number | null;
  reasons: string[];
  trait_reasons: Array<{ trait: TraitId; label: string; contribution: number }>;
  /** Type-match tier from candidate generation (0=exact, 1=centroid, 2=lexical, 99=none).
   *  Used in sort comparator so explicit types (e.g. "milk") dominate lexical hallu-
   *  cinated matches (e.g. whey mentioning "milk" in ingredients). */
  type_tier: number;
};

export type SearchV2Result = {
  intent: SearchIntentV2;
  candidates_total: number;
  items: RankedCandidate[];
  relaxed: boolean;
  relaxation_steps: string[];
  rank_source: "v2_structured" | "v2_goal" | "decision";
  decision?: { model: string; input_tokens: number | null; evaluated: number };
  summary: string;
  llm_calls: number;
  latency_ms: number;
  explored: boolean;
  /** Passed through from pipeline to adapter — avoids re-fetching the snapshot */
  snapshotIndex: ProductSearchIndexRow[];
  dietary_prevalence: DietaryPrevalenceMap;
};

/** §5 default gate — tuned by eval */
export const DATA_QUALITY_MIN = 0.5;

export const GOAL_EMBEDDING_THRESHOLD = 0.85;
export const INTENT_CACHE_THRESHOLD = 0.97;
export const CATEGORY_CENTROID_THRESHOLD = 0.5;
export const CATEGORY_CENTROID_TOP_K = 8;
