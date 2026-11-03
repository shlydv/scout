import { nutritionReviewStatus } from "@/lib/nutrition/review";
import { mergeNutrition, parseServingNutritionBlock, fillMissingNutritionFields } from "@/lib/grocery/parse-nutrition-block";
import { nutritionHasCriticalAnomalies, sanitizeNutrition, sanitizeNutritionWithLlm } from "@/lib/nutrition/anomaly";
import { nutritionIsSparse } from "@/lib/nutrition/completeness";
import {
  isReferenceNutritionEligible,
  matchReferenceFood,
  referenceToNutrition,
  stripIneligibleReferenceNutrition,
} from "@/lib/nutrition/reference-seed";
import type { ProductNutrition } from "@/lib/supabase/types";

/** Upper bounds for protein per 100g by product class (catch OCR / parser garbage). */
const PROTEIN_CEILING: Array<{ test: (name: string, cat: string) => boolean; max: number }> = [
  {
    test: (n, c) => /\b(whey|protein powder|isolate|mass gainer)\b/i.test(n + c),
    max: 90,
  },
  {
    test: (n, c) => /\b(high protein|protein atta|protein flour)\b/i.test(n + c),
    max: 55,
  },
  {
    test: (n, c) => /\b(honey|shahad)\b/i.test(n),
    max: 2,
  },
  {
    test: (n, c) => /\b(mouth freshener|mukhwas|supari|paan masala|chewing gum|breath freshener|mint balls?|candy|toffee|lollipop|khatta meetha)\b/i.test(n),
    max: 5,
  },
  {
    test: (n, c) =>
      /\b(masala|spice|seasoning|hing|turmeric|chilli powder|tea|coffee|matcha|herbal|green tea|black tea|chai|espresso|latte|cappuccino)\b/i.test(n) ||
      /\bmasala|spice/i.test(c),
    max: 12,
  },
  { test: () => true, max: 40 },
];

export function maxProteinPer100g(name: string, category: string | null): number {
  const c = category ?? "";
  for (const row of PROTEIN_CEILING) {
    if (row.test(name, c)) return row.max;
  }
  return 40;
}

export function nutritionLooksImplausible(
  nutrition: ProductNutrition,
  name: string,
  category: string | null,
  subcategory?: string | null,
): boolean {
  return nutritionHasCriticalAnomalies(nutrition, { name, category, subcategory });
}

/** Prefer Blinkit "Nutrition Information" attribute when platform/OCR rows are wrong. */
export function nutritionFromAttributes(
  attributes: Record<string, string> | null | undefined,
): ProductNutrition | null {
  if (!attributes) return null;
  let block: string | null = null;
  for (const [k, v] of Object.entries(attributes)) {
    if (!/nutri/i.test(k) || !v?.trim()) continue;
    if (v.includes("\n") || /per\s*100/i.test(v) || /per\s*100/i.test(k)) {
      block = v.trim();
      break;
    }
  }
  block ??=
    attributes["Nutrition Information"]?.trim() ??
    attributes["Nutritional Information"]?.trim() ??
    null;
  if (!block) return null;
  return parseServingNutritionBlock(block);
}

function isPaneerLike(ctx: {
  name: string;
  category: string | null;
  subcategory?: string | null;
}): boolean {
  const blob = `${ctx.name} ${ctx.category ?? ""} ${ctx.subcategory ?? ""}`.toLowerCase();
  return /\bpaneer\b|paneer & cream|fresh paneer|malai paneer|tofu paneer/.test(blob);
}

/** Common label OCR: 80g fat instead of 8.0g on paneer packs. */
function tryFixPaneerLabelErrors(
  nutrition: ProductNutrition,
  ctx: { name: string; category: string | null; subcategory?: string | null },
): ProductNutrition {
  if (!isPaneerLike(ctx)) return nutrition;
  const fat = nutrition.fat_g_100g;
  if (typeof fat !== "number" || fat <= 45) return nutrition;
  const scaled = Math.round(fat * 10) / 100;
  if (scaled < 5 || scaled > 35) return nutrition;
  return {
    ...nutrition,
    fat_g_100g: scaled,
    extra: {
      ...(nutrition.extra ?? {}),
      nutrition_corrected: "paneer_fat_decimal",
    },
  };
}

function supplementSparseNutrition(
  nutrition: ProductNutrition | null,
  ctx: { name: string; category: string | null; subcategory?: string | null },
): ProductNutrition | null {
  if (!isReferenceNutritionEligible(ctx.name, ctx.category, ctx.subcategory, nutrition)) {
    return stripIneligibleReferenceNutrition(nutrition, ctx);
  }

  const ref = matchReferenceFood(ctx.name, {
    category: ctx.category,
    subcategory: ctx.subcategory,
    minConfidence: 0.55,
  });
  if (!ref) return nutrition;

  const refNutrition = referenceToNutrition(ref.entry, ref);
  if (!nutrition) return refNutrition;

  if (!nutritionIsSparse(nutrition)) return nutrition;

  const filled = fillMissingNutritionFields(nutrition, refNutrition);
  return {
    ...filled,
    extra: {
      ...(filled.extra ?? {}),
      nutrition_gap_fill: ref.entry.id,
      nutrition_gap_fill_note: "Missing label fields filled from IFCT/USDA reference",
    },
  };
}

export function reconcileNutrition(opts: {
  nutrition: ProductNutrition | null;
  attributes?: Record<string, string> | null;
  name: string;
  category: string | null;
  subcategory?: string | null;
  net_weight?: string | null;
}): ProductNutrition | null {
  if (nutritionReviewStatus(opts.nutrition)) return opts.nutrition;
  const fromAttrs = nutritionFromAttributes(opts.attributes);
  const ctx = { name: opts.name, category: opts.category, subcategory: opts.subcategory };

  const current = stripIneligibleReferenceNutrition(opts.nutrition, ctx);
  if (!current && !fromAttrs) return null;

  let picked: ProductNutrition | null;

  if (!fromAttrs) {
    picked = current;
  } else if (!current) {
    picked = fromAttrs;
  } else if (nutritionIsSparse(current) && fromAttrs) {
    const merged = mergeNutrition(fromAttrs, current);
    picked =
      merged && !nutritionIsSparse(merged) ? { ...merged, source: "platform" } : fromAttrs;
  } else {
    const currentBad = nutritionHasCriticalAnomalies(current, ctx);
    const attrsBad = nutritionHasCriticalAnomalies(fromAttrs, ctx);
    const attrsPackMisscaled =
      !attrsBad &&
      !currentBad &&
      fromAttrs.energy_kcal_100g != null &&
      current.energy_kcal_100g != null &&
      fromAttrs.energy_kcal_100g < current.energy_kcal_100g * 0.55 &&
      fromAttrs.energy_kcal_100g < 90;

    if (currentBad && attrsBad) {
      picked = null;
    } else if (attrsPackMisscaled) {
      picked = current;
    } else if (currentBad && !attrsBad) {
      picked = { ...fromAttrs, source: "platform" };
    } else if (!currentBad && attrsBad) {
      picked = current;
    } else if (current.source === "ocr" && fromAttrs.protein_g_100g != null) {
      const p = current.protein_g_100g ?? 0;
      const ap = fromAttrs.protein_g_100g ?? 0;
      if (
        p > maxProteinPer100g(opts.name, opts.category) &&
        ap <= maxProteinPer100g(opts.name, opts.category)
      ) {
        picked = { ...current, ...fromAttrs, source: "platform" };
      } else {
        picked = current;
      }
    } else {
      picked = current;
    }
  }

  const fixed = picked ? tryFixPaneerLabelErrors(picked, ctx) : null;
  const sanitized = sanitizeNutrition(fixed, ctx);
  return supplementSparseNutrition(sanitized, ctx);
}

/**
 * Async version of reconcileNutrition — uses LLM validation before discarding data.
 * Use this in API routes. Falls back gracefully if LLM unavailable.
 */
export async function reconcileNutritionWithLlm(
  opts: Parameters<typeof reconcileNutrition>[0],
  cacheKey?: string,
): Promise<ReturnType<typeof reconcileNutrition>> {
  if (nutritionReviewStatus(opts.nutrition)) return opts.nutrition;
  const fromAttrs = nutritionFromAttributes(opts.attributes);
  const ctx = { name: opts.name, category: opts.category, subcategory: opts.subcategory };

  const current = stripIneligibleReferenceNutrition(opts.nutrition, ctx);
  if (!current && !fromAttrs) return null;

  let picked: ReturnType<typeof reconcileNutrition>;

  if (!fromAttrs) {
    picked = current;
  } else if (!current) {
    picked = fromAttrs;
  } else {
    // Delegate to sync path for the complex reconcile logic, then re-sanitize with LLM
    picked = reconcileNutrition(opts);
    if (!picked && current) {
      // The sync path discarded — try LLM rescue on the original data
      picked = current;
    }
  }

  const fixed = picked ? tryFixPaneerLabelErrors(picked, ctx) : null;
  const sanitized = await sanitizeNutritionWithLlm(fixed, ctx, cacheKey);
  return supplementSparseNutrition(sanitized, ctx);
}
