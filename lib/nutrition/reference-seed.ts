import produceData from "@/data/fresh-produce.json";
import referenceData from "@/data/reference-foods.json";
import { isPackagedProduceLike } from "@/lib/catalog/packaged-produce";
import { hasReferenceNutrition } from "@/lib/nutrition/completeness";
import type { ProductNutrition } from "@/lib/supabase/types";

export type ProduceKind =
  | "fruit"
  | "vegetable"
  | "leafy"
  | "tuber"
  | "gourd"
  | "legume"
  | "herb"
  | "mushroom"
  | "sprout"
  | "pulse";

export type ReferenceKind =
  | ProduceKind
  | "protein"
  | "dairy"
  | "grain"
  | "fat"
  | "nut";

export interface ReferenceEntry {
  id: string;
  kind: ReferenceKind;
  aliases: string[];
  /** Optional subcategory / category substring hints for weaker matches. */
  category_hints?: string[];
  /** Simple whole-food ingredient label. */
  ingredients: string;
  kcal: number;
  protein: number;
  carbs: number;
  fiber: number;
  sugar: number;
  fat: number;
  saturated_fat: number;
  sodium: number;
  notes?: string;
}

export type ReferenceMatchType = "exact_alias" | "token_overlap" | "category_hint";

export interface ReferenceMatch {
  entry: ReferenceEntry;
  confidence: number;
  match_type: ReferenceMatchType;
  matched_alias?: string;
}

type RawEntry = Omit<ReferenceEntry, "ingredients"> & { ingredients?: string };

function withIngredients(e: RawEntry): ReferenceEntry {
  const label =
    e.ingredients ??
    e.id
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return { ...e, ingredients: label };
}

const PRODUCE_ENTRIES = (
  (produceData as { entries: RawEntry[] }).entries ?? []
).map(withIngredients);

const REFERENCE_ENTRIES = (
  (referenceData as { entries: RawEntry[] }).entries ?? []
).map(withIngredients);

const ALL_ENTRIES: ReferenceEntry[] = [...PRODUCE_ENTRIES, ...REFERENCE_ENTRIES];

/** Aliases sorted longest-first so "chicken breast" beats "chicken". */
const SORTED_ALIASES: Array<{ alias: string; entry: ReferenceEntry }> = ALL_ENTRIES.flatMap(
  (entry) => entry.aliases.map((alias) => ({ alias: alias.toLowerCase(), entry })),
).sort((a, b) => b.alias.length - a.alias.length);

const NOISE_PATTERNS = [
  /\b(ozone\s*wash(ed)?|pesticide\s*cleaned|organically\s*grown|hydroponic|pesticide)\b/gi,
  /\b(fresh\s*cut|cut\b|peeled|diced|washed|cleaned|premium|organic|imported|local|desi|hybrid)\b/gi,
  /\b(pesticide\s*free|farm\s*fresh|hand\s*picked|vacuum\s*packed|combo|cocktail|portion|packet)\b/gi,
  /\b(\d+\s*(?:x\s*\d+\s*)?(?:g|kg|gm|gram|grams|ml|l|ltr|litre|liter|pcs|pc|piece|pieces|pack|nos|no|bunch|bundle))\b/gi,
  /\b(\d+\s*(?:kg|g|ml|l))\b/gi,
  /\(\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|l|pcs)?\s*\)/gi,
];

const BRAND_PREFIX_RE =
  /^(?:amul|nandini|mother\s*dairy|aavin|heritage|go|govind|nestle|britannia|parle|tata|fortune|saffola|daawat|india\s*gate|fortune|24\s*mantra|organic\s*india|licious|freshtohome|zepto|blinkit)\s+/i;

/** Strip brand prefixes, pack sizes, marketing noise, numbers, and units. */
export function normalizeProductName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");
  for (const re of NOISE_PATTERNS) s = s.replace(re, " ");
  s = s.replace(BRAND_PREFIX_RE, "");
  s = s.replace(/[^a-z\s-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter((t) => t.length > 1));
}

function tokenOverlapScore(normalized: string, alias: string): number {
  const nameTokens = tokenize(normalized);
  const aliasTokens = tokenize(alias);
  if (aliasTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of aliasTokens) {
    if (nameTokens.has(t)) overlap++;
  }
  return overlap / aliasTokens.size;
}

function categoryHintScore(
  entry: ReferenceEntry,
  category?: string | null,
  subcategory?: string | null,
): number {
  const hints = entry.category_hints;
  if (!hints?.length) return 0;
  const hay = `${category ?? ""} ${subcategory ?? ""}`.toLowerCase();
  if (!hay.trim()) return 0;
  let best = 0;
  for (const hint of hints) {
    const h = hint.toLowerCase();
    if (hay.includes(h)) best = Math.max(best, 0.85);
    else if (tokenOverlapScore(hay, h) >= 0.5) best = Math.max(best, 0.65);
  }
  return best;
}

function confidenceForMatch(
  matchType: ReferenceMatchType,
  overlap = 0,
  hintScore = 0,
): number {
  switch (matchType) {
    case "exact_alias":
      return 0.7;
    case "token_overlap":
      if (overlap >= 0.9) return 0.68;
      if (overlap >= 0.75) return 0.63;
      return 0.58;
    case "category_hint":
      return hintScore >= 0.8 ? 0.6 : 0.55;
  }
}

function tryExactAlias(normalized: string): ReferenceMatch | null {
  const padded = ` ${normalized} `;
  for (const { alias, entry } of SORTED_ALIASES) {
    const a = alias.replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
    if (!a) continue;
    const re = new RegExp(`(^|\\s)${escapeRe(a)}(es|s)?(\\s|$)`);
    if (re.test(padded)) {
      return {
        entry,
        confidence: confidenceForMatch("exact_alias"),
        match_type: "exact_alias",
        matched_alias: alias,
      };
    }
  }
  return null;
}

function tryTokenOverlap(normalized: string): ReferenceMatch | null {
  let best: ReferenceMatch | null = null;
  for (const { alias, entry } of SORTED_ALIASES) {
    const a = alias.replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
    if (!a || a.split(/\s+/).length < 2) continue;
    const overlap = tokenOverlapScore(normalized, a);
    if (overlap < 0.75) continue;
    const confidence = confidenceForMatch("token_overlap", overlap);
    if (!best || confidence > best.confidence) {
      best = {
        entry,
        confidence,
        match_type: "token_overlap",
        matched_alias: alias,
      };
    }
  }
  return best;
}

function tryCategoryHint(
  normalized: string,
  category?: string | null,
  subcategory?: string | null,
): ReferenceMatch | null {
  let best: ReferenceMatch | null = null;
  for (const entry of ALL_ENTRIES) {
    const hintScore = categoryHintScore(entry, category, subcategory);
    if (hintScore < 0.65) continue;
    const overlap = Math.max(
      ...entry.aliases.map((a) => tokenOverlapScore(normalized, a)),
    );
    if (overlap < 0.4) continue;
    if (STAPLE_KINDS.has(entry.kind) && !hasSpecificStapleToken(normalized, entry)) continue;
    const confidence = confidenceForMatch("category_hint", overlap, hintScore);
    if (!best || confidence > best.confidence) {
      best = {
        entry,
        confidence,
        match_type: "category_hint",
        matched_alias: entry.aliases[0],
      };
    }
  }
  return best;
}

// Categories where reference-seed (raw food) nutrition is meaningful.
// Anything outside this allowlist must NOT receive reference-fill — packaged products
// have brand/process-specific nutrition that raw-food reference data cannot represent.
const REFERENCE_FILL_ALLOWLIST = [
  "Fruits & Vegetables",
  "Fresh Fruits",
  "Fresh Vegetables",
  "Vegetables",
  "Fruits",
  "Eggs, Meat & Fish",
  "Chicken, Meat & Fish",
  "Eggs",
  "Paneer & Cheese",
  "Paneer & Cream",
  "Fresh Paneer",
  "Sprouts",
];

function isAllowedForReferenceFill(
  category?: string | null,
  subcategory?: string | null,
): boolean {
  const haystack = `${category ?? ""}|${subcategory ?? ""}`.toLowerCase();
  return REFERENCE_FILL_ALLOWLIST.some((c) => haystack.includes(c.toLowerCase()));
}

// Names that imply a processed/branded product even within allowed categories.
const PROCESSED_NAME_RE =
  /\b(milkshake|smoothie|drink|protein|powder|mix|shake|biscuit|cookie|cake|chocolate|ice\s*cream|noodle|chip|snack|bar|wafer|cracker|cereal|muesli|granola|yogurt|peanut\s+butter|jam|spread|sauce|ketchup|pickle|masala\s+mix|instant|fortified|flavoured|flavored)\b/i;

/** Ready meals, tadka jars, curry pastes — not dry whole staples. */
const PREPARED_PACKAGED_RE =
  /\b(tadka|tempering|quick\s*fry|fry\s*dried|ready\s*to\s*(?:eat|cook|serve)|rte\b|heat\s*(?:and|&)\s*(?:eat|serve)|just\s*add\s*water|curry\s*(?:paste|mix|powder)|gravy\s*(?:mix|base)|meal\s*(?:kit|mixer)|dal\s*makhani|kitchen\s*ready|in\s*\d+\s*min(?:ute)?s|precooked|pre\s*cooked|retort|cup\s*noodles?|cook\s*in\s*\d+)\b/i;

const STAPLE_KINDS = new Set<ReferenceKind>(["pulse", "grain", "fat", "protein", "dairy", "nut"]);

const GENERIC_STAPLE_TOKENS = new Set([
  "dal",
  "pulse",
  "lentil",
  "lentils",
  "rice",
  "atta",
  "flour",
  "gram",
  "bean",
  "beans",
  "pea",
  "peas",
  "split",
  "whole",
  "dry",
  "raw",
  "fresh",
  "organic",
  "premium",
  "unpolished",
  "polished",
]);

export function isPreparedOrPackagedFoodName(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  if (PREPARED_PACKAGED_RE.test(name) || PROCESSED_NAME_RE.test(name)) return true;
  if (
    /\b(jar|bottle|tin|pouch|sachet)\b/i.test(name) &&
    /\b(dal|curry|paste|gravy|tadka|ready|meal)\b/i.test(name)
  ) {
    return true;
  }
  return false;
}

function hasSpecificStapleToken(normalized: string, entry: ReferenceEntry): boolean {
  if (!STAPLE_KINDS.has(entry.kind)) return true;
  for (const alias of entry.aliases) {
    for (const t of tokenize(alias.replace(/[^a-z\s-]/g, " "))) {
      if (GENERIC_STAPLE_TOKENS.has(t)) continue;
      if (t.length < 3) continue;
      if (normalized.includes(t)) return true;
    }
  }
  return false;
}

function referenceExtra(nutrition: ProductNutrition): Record<string, number | string> {
  const extra = nutrition.extra;
  return extra && typeof extra === "object" ? (extra as Record<string, number | string>) : {};
}

/** Whether stored or new IFCT/USDA reference nutrition is appropriate for this SKU. */
export function isReferenceNutritionEligible(
  name: string | null | undefined,
  category?: string | null,
  subcategory?: string | null,
  nutrition?: ProductNutrition | null,
): boolean {
  if (isPreparedOrPackagedFoodName(name)) return false;
  if (!isAllowedForReferenceFill(category, subcategory)) return false;
  if (nutrition && hasReferenceNutrition(nutrition)) {
    const extra = referenceExtra(nutrition);
    if (extra.reference_match_type === "category_hint") {
      const refId = String(extra.reference_id ?? "");
      const entry = refId ? getReferenceById(refId) : null;
      const normalized = normalizeProductName(name);
      if (entry && normalized && !hasSpecificStapleToken(normalized, entry)) return false;
    }
  }
  return true;
}

/** Drop IFCT reference rows that should not apply (e.g. dal tadka jar matched as toor dal). */
export function stripIneligibleReferenceNutrition(
  nutrition: ProductNutrition | null,
  ctx: { name: string; category: string | null; subcategory?: string | null },
): ProductNutrition | null {
  if (!nutrition || !hasReferenceNutrition(nutrition)) return nutrition;
  if (isReferenceNutritionEligible(ctx.name, ctx.category, ctx.subcategory, nutrition)) {
    return nutrition;
  }
  const extra = referenceExtra(nutrition);
  if (extra.nutrition_gap_fill) {
    const nextExtra = { ...extra };
    for (const k of [
      "reference",
      "reference_id",
      "reference_match",
      "reference_match_type",
      "reference_confidence",
      "nutrition_gap_fill",
      "nutrition_gap_fill_note",
    ]) {
      delete nextExtra[k];
    }
    const next = { ...nutrition, extra: Object.keys(nextExtra).length ? nextExtra : undefined };
    return next;
  }
  return null;
}

/** Match a product name (and optional category hints) to a reference food entry. */
export function matchReferenceFood(
  name: string | null | undefined,
  opts?: {
    category?: string | null;
    subcategory?: string | null;
    minConfidence?: number;
  },
): ReferenceMatch | null {
  const normalized = normalizeProductName(name);
  if (!normalized) return null;

  if (isPreparedOrPackagedFoodName(name)) return null;

  // Only block reference fill for packaged items miscategorized as produce — not dairy paneer/tofu.
  if (isPackagedProduceLike(name, opts?.subcategory)) {
    const aisle = `${opts?.category ?? ""} ${opts?.subcategory ?? ""}`.toLowerCase();
    if (/fruit|vegetable|produce|herb|sprout|salad|greens/.test(aisle)) return null;
  }

  // HARD GUARD: only match raw-food categories. Packaged/branded products must
  // get nutrition from labels, OCR or Open Food Facts, never from raw reference data.
  if (!isAllowedForReferenceFill(opts?.category, opts?.subcategory)) return null;

  const minConfidence = opts?.minConfidence ?? 0.55;
  const exact = tryExactAlias(normalized);
  if (exact && exact.confidence >= minConfidence) return exact;

  const overlap = tryTokenOverlap(normalized);
  if (overlap && overlap.confidence >= minConfidence) {
    if (!exact || overlap.confidence > exact.confidence) return overlap;
  }
  if (exact) return exact.confidence >= minConfidence ? exact : null;

  const hint = tryCategoryHint(normalized, opts?.category, opts?.subcategory);
  if (hint && hint.confidence >= minConfidence) return hint;

  return null;
}

export function referenceToNutrition(
  entry: ReferenceEntry,
  match: ReferenceMatch,
): ProductNutrition {
  return {
    source: "platform",
    energy_kcal_100g: entry.kcal,
    protein_g_100g: entry.protein,
    carbs_g_100g: entry.carbs,
    fiber_g_100g: entry.fiber,
    sugar_g_100g: entry.sugar,
    added_sugar_g_100g: 0,
    fat_g_100g: entry.fat,
    saturated_fat_g_100g: entry.saturated_fat,
    sodium_mg_100g: entry.sodium,
    extra: {
      reference: "ifct_2017",
      reference_confidence: match.confidence,
      reference_match: match.matched_alias ?? entry.id,
      reference_id: entry.id,
      reference_match_type: match.match_type,
    },
  };
}

export function referenceIngredients(entry: ReferenceEntry): string {
  return entry.ingredients;
}

export function listReferenceIds(): string[] {
  return ALL_ENTRIES.map((e) => e.id);
}

export function getReferenceById(id: string): ReferenceEntry | null {
  return ALL_ENTRIES.find((e) => e.id === id) ?? null;
}

export function listReferenceEntries(): ReferenceEntry[] {
  return ALL_ENTRIES;
}
