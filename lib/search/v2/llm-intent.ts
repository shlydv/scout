/**
 * L3 online intent — Groq (fast/cheap) escalated to DeepSeek for complex queries.
 */
import { deepseekChat, extractJsonObject } from "@/lib/search/deepseek-client";
import {
  extractNumericConstraints,
  type NumericExtraction,
} from "@/lib/search/v2/numeric-constraints";
import type { IndexCatalogMeta } from "@/lib/search/v2/index-meta";
import type { ConstraintPriority, SearchIntentKind, SearchIntentV2, TraitId } from "@/lib/search/v2/types";
import { TRAIT_IDS } from "@/lib/search/v2/types";
import { CATEGORIES, TAXONOMY, SUBCATEGORIES, SUBCATEGORY_TO_CATEGORY } from "@/lib/search/v2/taxonomy.generated";

// Compact taxonomy for the prompt + canonical-casing validation maps. The resolver
// classifies the query into ONE clean subcategory; retrieval grounds on it.
const TAXONOMY_PROMPT = Object.entries(TAXONOMY)
  .map(([c, subs]) => `- ${c}: ${subs.join(", ")}`)
  .join("\n");
const SUB_CANON = new Map(SUBCATEGORIES.map((s) => [s.toLowerCase(), s]));
const CAT_CANON = new Map(CATEGORIES.map((c) => [c.toLowerCase(), c]));

/** Find matching catalog brands/types for the query — gives the LLM hints so it
 *  can pick canonical brand names ("cadbury bournvita" not "Bournvita") and
 *  avoid hallucinating terms not in the catalog. Limited to top-8 per category
 *  to stay within token budget (~200 chars). */
function buildCatalogHints(query: string, meta?: IndexCatalogMeta): string {
  if (!meta) return "";
  const norm = (s: string) => s.toLowerCase().replace(/['']/g, "").trim();
  const qNorm = norm(query);
  // Filter out negation words and short tokens (< 3 chars) to avoid noise
  const SKIP = new Set(["no", "not", "without", "bina", "bagair", "nahi", "nako", "free", "the", "and", "for", "with"]);
  const tokens = qNorm.split(/\s+/).filter((t) => t.length >= 3 && !SKIP.has(t));
  if (!tokens.length) return "";

  // Find brands whose normalized name contains any query token
  const brandMatches = [...meta.brands]
    .filter((b) => tokens.some((t) => norm(b).includes(t)) || norm(b).includes(qNorm))
    .slice(0, 8);

  const typeMatches = [...meta.primaryTypes]
    .filter((t) => tokens.some((tk) => norm(t).includes(tk)) || norm(t).includes(qNorm))
    .slice(0, 8);

  if (!brandMatches.length && !typeMatches.length) return "";

  const parts: string[] = [];
  if (brandMatches.length) parts.push(`brands: [${brandMatches.join(", ")}]`);
  if (typeMatches.length) parts.push(`types: [${typeMatches.join(", ")}]`);
  return `\nCatalog hints (use these exact names if relevant): ${parts.join("; ")}`;
}

const INTENT_SYSTEM_PROMPT = `You parse Indian grocery search queries into strict JSON for Scout Search.
Return exactly one JSON object. No markdown.

Schema:
{
  "kind": "directed"|"goal"|"brand"|"ambiguous",
  "goal_phrase": string|null,
  "brand": string|null,
  "primary_type": string|null,
  "category": string|null,
  "subcategory": string|null,
  "use_case": string|null,
  "required_flavours": string[],
  "modifiers": string[],
  "constraints": {
    "max_price"?: number,
    "max_sugar_g"?: number,
    "max_fat_g"?: number,
    "max_calories"?: number,
    "min_protein_g"?: number,
    "vegan"?: boolean,
    "vegetarian"?: boolean,
    "gluten_free"?: boolean,
    "palm_oil_free"?: boolean,
    "avoid_ingredients"?: string[],
    "allergens_excluded"?: string[]
  },
  "constraint_priorities": [{"field": string, "priority": number}],
  "sort": "best_match"|"cheapest"|"healthiest"|"highest_protein"|"lowest_sugar",
  "comparison_ref": string|null,
  "comparison_mode": "healthier_than"|"cheaper_than"|null,
  "intent_confidence": number,
  "explanation": string,
  "trait_weights": {string: number}
}

Rules:
- BRAND = a manufacturer / company name (the maker), e.g. Amul, Nestlé, Epigamia, Wedel.
  Descriptive qualifiers that describe the product itself — cow, buffalo, olive, milk, dark,
  fresh, raw, organic, salted, roasted — are NOT brands; put such a qualifier in
  required_flavours (it narrows the variant), and leave brand null unless an actual maker is named.
- kind:"brand" ONLY when the query is purely a brand name with no product type. If a product
  type is present, kind:"directed" and brand is just an optional filter (often null).
  Multi-word brand names that contain words that COULD be product types ("bakery", "tea",
  "dairy") are still brands when the name refers to a manufacturer.
  e.g. "cow ghee" → kind:"directed", primary_type:"ghee", required_flavours:["cow"], brand:null.
  "olive oil" → primary_type:"olive oil" (keep multi-word types together), brand:null.
  "karachi bakery" → kind:"brand", brand:"Karachi Bakery".
  "taj mahal tea" → kind:"brand", brand:"Taj Mahal Tea".
- Understand Hindi/Hinglish natively (doodh, bina cheeni, nahi).
- "chocolate milk" → primary_type:"milk", required_flavours:["chocolate"]. "milk chocolate" →
  primary_type:"chocolate", required_flavours:["milk"]. Decide the head noun by product meaning;
  the qualifier is a flavour, never a brand.
- category/subcategory (CRITICAL — this is the grounding retrieval filters on): classify the
  query's product into EXACTLY ONE subcategory, and its parent category, from the TAXONOMY listed
  at the end. Use the exact subcategory string. Decide by the product's TRUE type, not surface
  tokens: "chocolate milk"→"Milk Drinks", "mango juice"→"Fruit Juices & Drinks", "muesli"→
  "Muesli & Oats", "cow ghee"→"Ghee", "dark chocolate"→"Chocolates". Set BOTH null only for pure
  goal/brand queries with no product type. If you know the category but not the exact subcategory,
  set category and leave subcategory null.
- Goal/vague queries (healthy drinks for running, tiffin not junk) → kind:"goal" with goal_phrase.
- Use-case queries (pre-workout snack, school lunch) → kind:"directed" or "goal" with use_case slug (pre_workout, school_lunch).
- Type + health context or vague nutrition adjective WITHOUT a number (diabetic bread, protein shake with low calories, drinks for athletes with a type) → kind:"directed", set primary_type for membership AND set goal_phrase to the health/nutrition intent ("diabetic friendly", "low calorie", "athlete recovery") so ranking uses its traits. Set max_calories only when a number is given ("under 100 calories").
- "high protein milk" → primary_type:"milk", sort:"highest_protein", do NOT set min_protein_g.
- Standalone health modifier with NO product type ("high protein", "low sugar", "low calorie",
  "high fiber", "no added sugar") → kind:"goal", goal_phrase set to the modifier phrase,
  primary_type:null, sort set appropriately. These are health goals, not type-directed queries.
  Do NOT invent a random primary_type like "chicken thighs" — leave it null when no real type exists.
- constraint_priorities: lower number = relax first (price before sugar before avoid_ingredients).
- modifiers may include: high_protein_tier, low_sugar, no_added_sugar when user asks relatively.
- Populate avoid_ingredients/allergens from negation in the query (X-free, no X, without X).
  "lactose free" → allergens_excluded: ["lactose"]. "dairy free" → allergens_excluded: ["dairy"].
  "nut free" / "peanut free" / "soy free" → allergens_excluded: [the allergen word].
  "gluten free" → constraints.gluten_free:true (dietary boolean, not allergen).
  "no maida" / "without preservatives" / "no artificial colours" → avoid_ingredients.
  "no palm oil" (ingredient avoidance, not dietary boolean) → avoid_ingredients: ["palm oil"].
  "no artificial sweetener" / "no sweeteners" / "sugar free" (by ingredient) → avoid_ingredients: ["artificial sweetener"].
  "no preservatives" → avoid_ingredients: ["preservative"].
  "no artificial colors" / "no artificial colour" → avoid_ingredients: ["artificial color"].
  CRITICAL — sugar distinction:
  "no sugar" / "zero sugar" / "sugar free" → max_sugar_g: 0 (hard filter: no sugar of any kind).
  "no added sugar" / "without added sugar" / "no refined sugar" → modifiers:["no_added_sugar"],
    do NOT set max_sugar_g or avoid_ingredients. Products with natural sugar (fruit, honey, milk)
    are still acceptable to the user — they just don't want refined/added sugar.
  These umbrella terms are auto-expanded against the ingredient-known dictionary.
- "healthier than maggi" → comparison_ref:"maggi", comparison_mode:"healthier_than", sort:"healthiest".
- "cheaper than amul butter" → comparison_ref:"amul butter", comparison_mode:"cheaper_than", sort:"cheapest".
- trait_weights is REQUIRED for EVERY query. Map HEALTH/NUTRITION intent to trait weights.
  Use only these trait IDs: ${TRAIT_IDS.join(", ")}. Sum must be 1.0.
  For neutral queries ("amul", "atta"), return {"whole_food": 1.0}.
  For junk food with asked-for improvement ("healthy chips"), distribute across traits.
  NEVER return empty {} — this field is mandatory.

TAXONOMY — choose category + subcategory from this list ONLY (exact strings):
${TAXONOMY_PROMPT}`;

/** Groq API — faster, free-tier alternative to DeepSeek for simple queries. */

type LlmIntentJson = {
  kind?: SearchIntentKind;
  goal_phrase?: string | null;
  brand?: string | null;
  primary_type?: string | null;
  category?: string | null;
  subcategory?: string | null;
  use_case?: string | null;
  required_flavours?: string[];
  modifiers?: string[];
  constraints?: SearchIntentV2["constraints"];
  constraint_priorities?: ConstraintPriority[];
  sort?: SearchIntentV2["sort"];
  comparison_ref?: string | null;
  comparison_mode?: SearchIntentV2["comparison_mode"];
  intent_confidence?: number;
  explanation?: string;
  trait_weights?: Record<string, number>;
};

function mergeNumericIntoIntent(
  base: SearchIntentV2,
  numeric: NumericExtraction,
): SearchIntentV2 {
  const constraints = { ...base.constraints };
  if (numeric.max_price != null) constraints.max_price = numeric.max_price;
  if (numeric.max_sugar_g != null) constraints.max_sugar_g = numeric.max_sugar_g;
  if (numeric.max_fat_g != null) constraints.max_fat_g = numeric.max_fat_g;
  if (numeric.max_calories != null) constraints.max_calories = numeric.max_calories;
  if (numeric.min_protein_g != null && !base.primary_type) {
    constraints.min_protein_g = numeric.min_protein_g;
  }

  const modifiers = [...base.modifiers];
  if (numeric.high_protein_tier && !modifiers.includes("high_protein_tier")) {
    modifiers.push("high_protein_tier");
  }
  if (numeric.low_sugar_tier && !modifiers.includes("low_sugar")) modifiers.push("low_sugar");
  if (numeric.no_added_sugar && !modifiers.includes("no_added_sugar")) {
    modifiers.push("no_added_sugar");
  }

  return {
    ...base,
    constraints,
    modifiers,
    sort: numeric.sort !== "best_match" ? numeric.sort : base.sort,
  };
}

function normalizeLlmIntent(raw: LlmIntentJson, query: string): SearchIntentV2 {
  const constraints = {
    avoid_ingredients: raw.constraints?.avoid_ingredients ?? [],
    allergens_excluded: raw.constraints?.allergens_excluded ?? [],
    max_price: raw.constraints?.max_price,
    max_sugar_g: raw.constraints?.max_sugar_g,
    max_fat_g: raw.constraints?.max_fat_g,
    max_calories: raw.constraints?.max_calories,
    min_protein_g: raw.constraints?.min_protein_g,
    vegan: raw.constraints?.vegan,
    vegetarian: raw.constraints?.vegetarian,
    gluten_free: raw.constraints?.gluten_free,
    palm_oil_free: raw.constraints?.palm_oil_free,
  };

  const kind: SearchIntentKind =
    raw.kind === "goal" || raw.kind === "brand" || raw.kind === "ambiguous"
      ? raw.kind
      : "directed";

  // Validate the LLM facet against the controlled taxonomy (drop hallucinations,
  // canonicalize casing). Directed queries ground at SUBCATEGORY when confident.
  // Goal queries ("healthy drinks for running", "snacks for diabetics") span many
  // subcategories within a product class, so ground them at the wider CATEGORY — the
  // named class is still a real constraint ("drinks" must not surface sattu atta), but
  // a single subcategory over-narrows them. Trait ranking orders within that category.
  const isGoal = kind === "goal";
  const sub = raw.subcategory ? SUB_CANON.get(raw.subcategory.toLowerCase().trim()) : undefined;
  const catRaw = raw.category ? CAT_CANON.get(raw.category.toLowerCase().trim()) : undefined;
  const facetCat = sub ? (SUBCATEGORY_TO_CATEGORY[sub] ?? catRaw) : catRaw;
  const subOut = isGoal ? undefined : sub;

  return {
    kind,
    // Keep goal_phrase even for directed queries — "diabetic bread" / "protein shake
    // with low calories" stay type-filtered (membership) but rank by the health/nutrition
    // traits the goal_phrase decomposes into. Pure-pointed queries leave it null.
    goal_phrase: raw.goal_phrase?.trim() || null,
    goal_id: null,
    brand: raw.brand?.trim() || null,
    primary_type: raw.primary_type?.trim().toLowerCase() || null,
    facet_subcategories: subOut ? [subOut] : undefined,
    facet_categories: facetCat ? [facetCat] : undefined,
    use_case: raw.use_case?.trim().toLowerCase().replace(/[\s-]+/g, "_") || null,
    required_flavours: (raw.required_flavours ?? []).map((f) => f.toLowerCase()),
    modifiers: raw.modifiers ?? [],
    constraints,
    constraint_priorities: raw.constraint_priorities ?? defaultConstraintPriorities(constraints),
    sort: raw.sort ?? "best_match",
    comparison_ref: raw.comparison_ref?.trim() || null,
    comparison_mode: raw.comparison_mode ?? null,
    confidence: Math.max(0, Math.min(1, raw.intent_confidence ?? 0.4)),
    intent_source: "llm-deepseek",
    raw_query: query,
    trait_weights: validateTraitWeights(raw.trait_weights ?? {}),
  };
}

function defaultConstraintPriorities(
  c: SearchIntentV2["constraints"],
): ConstraintPriority[] {
  const out: ConstraintPriority[] = [];
  let p = 1;
  if (c.avoid_ingredients.length) out.push({ field: "avoid_ingredients", priority: p++ });
  if (c.min_protein_g != null) out.push({ field: "min_protein_g", priority: p++ });
  if (c.max_sugar_g != null) out.push({ field: "max_sugar_g", priority: p++ });
  if (c.max_fat_g != null) out.push({ field: "max_fat_g", priority: p++ });
  if (c.max_price != null) out.push({ field: "max_price", priority: p++ });
  return out;
}

export async function parseIntentWithLlm(
  query: string,
  opts: {
    escalateDeepseek?: boolean;
    catalogMeta?: IndexCatalogMeta;
  } = {},
): Promise<{ intent: SearchIntentV2; llm_calls: number }> {
  const numeric = extractNumericConstraints(query);
  const hints = buildCatalogHints(query, opts.catalogMeta);

  // Legacy offline intent evaluation only; online search uses Cloudflare.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { content } = await deepseekChat({
        usageKind: "search",
        jsonObject: true,
        maxTokens: 400,
        timeoutMs: attempt === 1 ? 6_000 : 10_000,
        system: INTENT_SYSTEM_PROMPT,
        user: `Query: ${query}${hints}`,
      });
      let intent = normalizeLlmIntent(extractJsonObject(content) as LlmIntentJson, query);
      intent.intent_source = "llm-deepseek";

      intent = mergeNumericIntoIntent(intent, numeric);
      if (!intent.comparison_ref && numeric.comparison_ref) {
        intent = {
          ...intent,
          comparison_ref: numeric.comparison_ref,
          comparison_mode: numeric.comparison_mode ?? null,
        };
      }

      return { intent, llm_calls: 1 };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error("LLM intent parsing failed after retries");
}

/** §11 relaxation: LLM proposes next-broader intent */
export async function relaxIntentWithLlm(
  intent: SearchIntentV2,
  opts: { type_neighbors?: string[] } = {},
): Promise<{ intent: SearchIntentV2; explanation: string; llm_calls: number }> {
  const sorted = [...intent.constraint_priorities].sort((a, b) => a.priority - b.priority);
  const next = sorted[0]?.field;

  const { content } = await deepseekChat({
    usageKind: "search",
    jsonObject: true,
    maxTokens: 800,
    timeoutMs: 8_000,
    system: `You broaden a grocery search intent when results are sparse. Never change primary_type or required_flavours. Return JSON: {"intent":{...same schema as parse...},"explanation":string}`,
    user: JSON.stringify({
      current_intent: intent,
      relax_field: next ?? "modifiers",
      embedding_neighbor_types: opts.type_neighbors ?? [],
    }),
  });

  const parsed = extractJsonObject(content) as { intent?: LlmIntentJson; explanation?: string };
  const relaxed = normalizeLlmIntent(parsed.intent ?? {}, intent.raw_query);
  relaxed.intent_source = intent.intent_source;

  return {
    intent: {
      ...relaxed,
      primary_type: intent.primary_type,
      required_flavours: intent.required_flavours,
      goal_phrase: intent.goal_phrase,
      kind: intent.kind,
    },
    explanation: parsed.explanation ?? `Relaxed ${next ?? "constraints"}`,
    llm_calls: 1,
  };
}

export function validateTraitWeights(weights: Record<string, number>): Partial<Record<TraitId, number>> {
  const out: Partial<Record<TraitId, number>> = {};
  let sum = 0;
  for (const id of TRAIT_IDS) {
    const w = weights[id];
    if (typeof w === "number" && w > 0) {
      out[id] = w;
      sum += w;
    }
  }
  if (sum <= 0) return out;
  for (const id of Object.keys(out) as TraitId[]) {
    out[id] = (out[id] ?? 0) / sum;
  }
  return out;
}
