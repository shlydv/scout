import { nutritionReviewSnapshot, nutritionReviewStatus } from "@/lib/nutrition/review";
import type { ProductNutrition } from "@/lib/supabase/types";

export type NutritionAnomalyCode =
  | "manual_review_incomplete"
  | "macro_mass_exceeds_100g"
  | "kcal_mismatch"
  | "category_protein_high"
  | "category_protein_critical"
  | "category_oil_macros"
  | "sugar_exceeds_carbs"
  | "decimal_anomaly"
  | "kcal_protein_swap"
  | "energy_high_low_protein"
  | "energy_per_serve_misread"
  | "protein_carbs_swap"
  | "individual_macro_exceeds_100g"
  | "per_pack_not_per_100g";

export type NutritionAnomaly = {
  code: NutritionAnomalyCode;
  severity: "critical" | "warning";
  message: string;
  field?: keyof ProductNutrition;
};

export type NutritionContext = {
  name: string;
  category?: string | null;
  subcategory?: string | null;
};

const MACRO_KEYS = ["protein_g_100g", "carbs_g_100g", "fat_g_100g"] as const;
// Three independently rounded two-decimal values can total 100.01g.
// Allow only that normalization noise, not a material excess of mass.
const MAX_MACRO_MASS_G = 100.02;

function ctxText(ctx: NutritionContext): string {
  return [ctx.name, ctx.category, ctx.subcategory].filter(Boolean).join(" ");
}

function isTeaOrCoffee(ctx: NutritionContext): boolean {
  return /\b(tea|coffee|chai|espresso|latte|herbal)\b/i.test(ctxText(ctx));
}

function isCookingOil(ctx: NutritionContext): boolean {
  return /\b(cooking oil|edible oil|mustard oil|sunflower oil|groundnut oil|olive oil|ghee|refined oil)\b/i.test(
    ctxText(ctx),
  );
}

function isMouthFreshenerOrCandy(ctx: NutritionContext): boolean {
  return /\b(mouth freshener|mukhwas|mukhwas|supari|paan masala|chewing gum|breath freshener|mint balls?|candy|toffee|lollipop|khatta meetha)\b/i.test(
    ctxText(ctx),
  );
}

function isNoodlesOrInstantMeal(ctx: NutritionContext): boolean {
  return /\b(noodle|noodles|instant noodles|cup noodles|happy bowl|ramen|maggi|macaroni|pasta meal)\b/i.test(
    ctxText(ctx),
  );
}

function isHighProteinCategory(ctx: NutritionContext): boolean {
  return /\b(whey|protein powder|isolate|paneer|chicken|broiler|egg|fish|meat|mutton|soya chunk|soybean|tofu|tempeh|greek yogurt|protein bar|mass gainer|seitan|edamame|peanut butter|almond butter|cashew butter|nut butter|pumpkin seed|hemp seed|chia seed|flax seed|sesame seed|sunflower seed|watermelon seed|melon seed|peanuts?|almonds?|cashews?|walnuts?|pistachios?|hazelnuts?|brazil nuts?|pecans?|macadamia|pine nuts?|nuts? mix|trail mix|chana|chickpea|kabuli|kala chana|rajmah|rajma|kidney bean|black bean|moong|mung|urad|toor|tur|arhar|masoor|lentil|dal\b|dhal\b|pulses?\b|lobia|cowpea|black eyed|peas?\b|red gram|green gram|matki|moth bean|horse gram|kala channa|cheese|parmesan|cheddar|mozzarella|gouda|feta|halloumi|quark|cottage cheese|skyr|labneh|nutritional yeast|spirulina)\b/i.test(
    ctxText(ctx),
  );
}

function macroSum(n: ProductNutrition): number {
  // Fibre included in total carbohydrate still contributes physical mass.
  return (n.protein_g_100g ?? 0) + (n.carbs_g_100g ?? 0) + (n.fat_g_100g ?? 0);
}

function impliedKcal(n: ProductNutrition): number | null {
  const p = n.protein_g_100g;
  const c = n.carbs_g_100g;
  const f = n.fat_g_100g;
  if (p == null && c == null && f == null) return null;
  const fiber = n.fiber_g_100g;
  const extra = n.extra;
  if (nutritionReviewStatus(n) === "verified"
    && extra?.manual_review_carb_basis === "total_includes_fiber"
    && extra.manual_review_carb_basis_snapshot === nutritionReviewSnapshot(n)
    && typeof extra.manual_review_carb_basis_source === "string"
    && typeof p === "number" && Number.isFinite(p) && p >= 0
    && typeof c === "number" && Number.isFinite(c) && c >= 0
    && typeof f === "number" && Number.isFinite(f) && f >= 0
    && typeof fiber === "number" && Number.isFinite(fiber) && fiber >= 0 && fiber <= c) {
    // The verified review already validates the JSON source list. Require the
    // explicit carbohydrate-basis evidence to belong to that same review.
    const sources: string[] = JSON.parse(extra.manual_review_sources as string);
    if (sources.includes(extra.manual_review_carb_basis_source)) {
      // Plausibility only: digestible carbohydrate 4 kcal/g, fibre 2 kcal/g.
      // Keep the declared energy and nutrient values unchanged.
      return 4 * p + 4 * (c - fiber) + 9 * f + 2 * fiber;
    }
  }
  return 4 * (p ?? 0) + 4 * (c ?? 0) + 9 * (f ?? 0);
}

export function kcalMismatchRatio(n: ProductNutrition): number | null {
  const kcal = n.energy_kcal_100g;
  const implied = impliedKcal(n);
  if (kcal == null || implied == null || kcal <= 20) return null;
  return Math.abs(kcal - implied) / kcal;
}

function looksLikeDecimalError(value: number, n: ProductNutrition, ctx: NutritionContext): boolean {
  if (value < 10) return false;
  for (const div of [10, 100]) {
    const scaled = value / div;
    if (scaled <= 0 || scaled >= value) continue;
    const trial = { ...n, protein_g_100g: n.protein_g_100g, carbs_g_100g: n.carbs_g_100g, fat_g_100g: n.fat_g_100g };
    if (n.protein_g_100g === value) trial.protein_g_100g = scaled;
    if (n.carbs_g_100g === value) trial.carbs_g_100g = scaled;
    if (n.fat_g_100g === value) trial.fat_g_100g = scaled;
    const before = kcalMismatchRatio(n);
    const after = kcalMismatchRatio(trial);
    if (after != null && (before == null || after < before * 0.5)) {
      if (isTeaOrCoffee(ctx) && scaled <= 25) return true;
      if (macroSum(trial) <= MAX_MACRO_MASS_G && scaled <= 90) return true;
    }
  }
  return false;
}

export function detectNutritionAnomalies(
  nutrition: ProductNutrition,
  ctx: NutritionContext,
): NutritionAnomaly[] {
  const reviewStatus = nutritionReviewStatus(nutrition);
  const out: NutritionAnomaly[] = [];
  if (reviewStatus === "partial" || reviewStatus === "label_conflict") {
    out.push({ code: "manual_review_incomplete", severity: "critical", message: "Label review found unresolved or contradictory nutrition; do not infer missing values or score this product." });
  }
  const sum = macroSum(nutrition);

  if (sum > MAX_MACRO_MASS_G) {
    out.push({
      code: "macro_mass_exceeds_100g",
      severity: "critical",
      message: `Protein + carbs + fat (${sum.toFixed(1)}g) exceeds 100g per 100g`,
    });
  }

  // Individual macro ceiling — any single macro >100g/100g is physically impossible
  // and almost always means the value is per-pack, not per-100g.
  for (const key of MACRO_KEYS) {
    const v = nutrition[key];
    if (typeof v === "number" && v > 100) {
      out.push({
        code: "individual_macro_exceeds_100g",
        severity: "critical",
        message: `${key.replace("_g_100g", "")} (${v}g) exceeds 100g per 100g — likely per-pack value`,
        field: key,
      });
    }
  }

  const mismatch = kcalMismatchRatio(nutrition);
  // Threshold raised from 0.35 → 0.50: Indian labels commonly have ±15% per macro field,
  // and rounding errors compound. 35% was too aggressive — nullified ~20% of real data.
  // Still catches bad OCR reads (e.g., energy read as "50" on a 600-kcal product).
  if (mismatch != null && mismatch > 0.50) {
    out.push({
      code: "kcal_mismatch",
      severity: "critical",
      message: `Energy (${nutrition.energy_kcal_100g} kcal) doesn't match macros (Δ ${(mismatch * 100).toFixed(0)}%)`,
      field: "energy_kcal_100g",
    });
  }

  const protein = nutrition.protein_g_100g;
  const energy = nutrition.energy_kcal_100g;

  if (typeof protein === "number" && isMouthFreshenerOrCandy(ctx)) {
    const max = 5;
    if (protein > max) {
      out.push({
        code: "category_protein_critical",
        severity: protein > 15 ? "critical" : "warning",
        message: `Mouth freshener / candy with ${protein}g protein per 100g is implausible (likely bad data)`,
        field: "protein_g_100g",
      });
    }
  }

  if (typeof protein === "number" && !isHighProteinCategory(ctx)) {
    if (protein > 55) {
      out.push({
        code: "category_protein_critical",
        severity: "critical",
        message: `${protein}g protein per 100g is implausible for this product type`,
        field: "protein_g_100g",
      });
    } else if (protein > 35 && (energy == null || energy < 80)) {
      // Tightened from energy < 150 → < 80: paneer is legitimately 25g protein at ~140 kcal,
      // tofu at 8g protein at ~50 kcal. Only flag when energy is truly implausibly low (< 80).
      out.push({
        code: "category_protein_high",
        severity: "warning",
        message: `Very high protein (${protein}g) with suspiciously low energy — label data may be wrong`,
        field: "protein_g_100g",
      });
    }
  }

  if (typeof protein === "number" && isNoodlesOrInstantMeal(ctx)) {
    // Raised from 20 → 30: bean/lentil-based noodles (e.g. Slurrp Farm) legitimately hit 18-25g.
    if (protein > 30) {
      out.push({
        code: "category_protein_critical",
        severity: "critical",
        message: `Instant noodles with ${protein}g protein per 100g is implausible — label data may be wrong`,
        field: "protein_g_100g",
      });
    } else if (protein > 15) {
      out.push({
        code: "category_protein_high",
        severity: "warning",
        message: `Instant noodles with ${protein}g protein per 100g is unusually high — check label`,
        field: "protein_g_100g",
      });
    }
  }

  if (typeof protein === "number" && isTeaOrCoffee(ctx)) {
    if (protein > 12) {
      out.push({
        code: "category_protein_critical",
        severity: "critical",
        message: `Tea/coffee with ${protein}g protein per 100g is implausible`,
        field: "protein_g_100g",
      });
    } else if (protein > 5) {
      out.push({
        code: "category_protein_high",
        severity: "warning",
        message: `Tea/coffee with ${protein}g protein per 100g is unusually high`,
        field: "protein_g_100g",
      });
    }
  }

  if (isCookingOil(ctx)) {
    const p = nutrition.protein_g_100g ?? 0;
    const c = nutrition.carbs_g_100g ?? 0;
    if (p > 2 || c > 2) {
      out.push({
        code: "category_oil_macros",
        severity: p > 5 || c > 5 ? "critical" : "warning",
        message: `Cooking oil with protein ${p}g / carbs ${c}g per 100g is implausible`,
      });
    }
  }

  const sugar = nutrition.sugar_g_100g;
  const carbs = nutrition.carbs_g_100g;
  if (typeof sugar === "number" && typeof carbs === "number" && sugar > carbs) {
    const likelyDecimalCarbs = carbs < 15 && sugar >= 10;
    out.push({
      code: "sugar_exceeds_carbs",
      severity: likelyDecimalCarbs ? "critical" : "warning",
      message: `Sugar (${sugar}g) exceeds total carbs (${carbs}g) — carbs may be mis-scaled`,
      field: "sugar_g_100g",
    });
  }

  if (
    typeof protein === "number" &&
    protein > 15 &&
    typeof nutrition.energy_kcal_100g === "number" &&
    nutrition.energy_kcal_100g > 0 &&
    nutrition.energy_kcal_100g < 30
  ) {
    out.push({
      code: "kcal_protein_swap",
      severity: "critical",
      message: "Protein and energy values may be swapped (OCR/column error)",
    });
  }

  if (
    typeof nutrition.energy_kcal_100g === "number" &&
    nutrition.energy_kcal_100g > 900 &&
    (protein ?? 0) < 5
  ) {
    out.push({
      code: "energy_high_low_protein",
      severity: "critical",
      message: "Very high energy with negligible protein — likely bad parse",
      field: "energy_kcal_100g",
    });
  }

  if (
    typeof protein === "number" &&
    isHighProteinCategory(ctx) &&
    typeof energy === "number" &&
    energy > 0 &&
    energy < 35 && // raised from 55: silken tofu (~50 kcal), konjac noodles (~10 kcal) are legitimate
    protein >= 4
  ) {
    out.push({
      code: "energy_per_serve_misread",
      severity: "critical",
      message: `${energy} kcal per 100g is too low for a protein food — likely per-serve misread`,
      field: "energy_kcal_100g",
    });
  }

  // Column-swap heuristic: protein ↔ carbs. Common LM mistake when extracting
  // nutrition tables — the model picks the right NUMBERS but the wrong COLUMN.
  // Trigger when protein looks impossible-high AND carbs looks impossible-low
  // for a non-protein-category product, AND swapping would make both plausible.
  if (
    typeof protein === "number" &&
    typeof nutrition.carbs_g_100g === "number" &&
    !isHighProteinCategory(ctx) &&
    !isCookingOil(ctx) &&
    protein > 35 &&
    nutrition.carbs_g_100g < 25 &&
    protein > nutrition.carbs_g_100g * 2
  ) {
    out.push({
      code: "protein_carbs_swap",
      severity: "critical",
      message: `Protein (${protein}g) and carbs (${nutrition.carbs_g_100g}g) columns may be swapped`,
      field: "protein_g_100g",
    });
  }

  for (const key of MACRO_KEYS) {
    const v = nutrition[key];
    if (typeof v === "number" && looksLikeDecimalError(v, nutrition, ctx)) {
      out.push({
        code: "decimal_anomaly",
        severity: "warning",
        message: `${key.replace("_g_100g", "")} (${v}g) may be missing a decimal point`,
        field: key,
      });
      break;
    }
  }

  // Per-pack misread: macro values that exceed the category ceiling but look like
  // per-pack totals (e.g., 21g protein in a 30g serving × 7 servings = 147g total).
  // Detect when ALL three macros scale by roughly the same factor from plausible per-100g.
  if (typeof protein === "number" && typeof carbs === "number" && typeof nutrition.fat_g_100g === "number") {
    // Category-specific protein ceilings (mirrors lib/nutrition/sanity.ts PROTEIN_CEILING)
    let ceiling = 40;
    if (isTeaOrCoffee(ctx)) ceiling = 12;
    else if (isMouthFreshenerOrCandy(ctx)) ceiling = 5;
    else if (isHighProteinCategory(ctx)) ceiling = 90;

    if (protein > ceiling && protein <= ceiling * 30 && !out.some((a) => a.code === "individual_macro_exceeds_100g")) {
      const fat = nutrition.fat_g_100g;
      if (carbs > 40 || fat > 40) {
        out.push({
          code: "per_pack_not_per_100g",
          severity: "critical",
          message: `Macros (P${protein}/C${carbs}/F${fat}g) look like per-pack values, not per-100g`,
          field: "protein_g_100g",
        });
      }
    }
  }

  // A source-verified label can legitimately exceed generic category expectations.
  // Physical inconsistencies remain visible even on a reviewed record.
  const categoryGuesses = new Set<NutritionAnomalyCode>([
    "category_protein_high", "category_protein_critical", "category_oil_macros",
    "protein_carbs_swap", "kcal_protein_swap", "decimal_anomaly",
    "energy_high_low_protein", "energy_per_serve_misread", "per_pack_not_per_100g",
  ]);
  return reviewStatus === "verified" ? out.filter(a => !categoryGuesses.has(a.code)) : out;
}

export function nutritionHasCriticalAnomalies(
  nutrition: ProductNutrition | null | undefined,
  ctx: NutritionContext,
): boolean {
  if (!nutrition) return false;
  return detectNutritionAnomalies(nutrition, ctx).some((a) => a.severity === "critical");
}

/** True when macro-based score copy would mislead (any protein-related anomaly). */
export function nutritionMacrosUntrustworthy(
  nutrition: ProductNutrition | null | undefined,
  ctx: NutritionContext,
): boolean {
  if (!nutrition) return true;
  const anomalies = detectNutritionAnomalies(nutrition, ctx);
  if (anomalies.some((a) => a.severity === "critical")) return true;
  return anomalies.some(
    (a) =>
      a.field === "protein_g_100g" ||
      a.code === "category_protein_critical" ||
      a.code === "category_protein_high" ||
      a.code === "kcal_protein_swap" ||
      a.code === "decimal_anomaly" ||
      a.code === "sugar_exceeds_carbs" ||
      a.code === "macro_mass_exceeds_100g" ||
      a.code === "protein_carbs_swap",
  );
}

function scaleMacro(n: ProductNutrition, key: (typeof MACRO_KEYS)[number], factor: number): ProductNutrition {
  const v = n[key];
  if (typeof v !== "number") return n;
  return { ...n, [key]: Math.round(v * factor * 1000) / 1000 };
}

function swapProteinCarbs(n: ProductNutrition): ProductNutrition {
  const next = { ...n };
  const p100 = next.protein_g_100g;
  const c100 = next.carbs_g_100g;
  if (typeof p100 === "number" && typeof c100 === "number") {
    next.protein_g_100g = c100;
    next.carbs_g_100g = p100;
  }
  // Also swap the per-serve mirror in extra (set by attachPerServeNutrition)
  const extra = next.extra ? { ...next.extra } : null;
  if (extra) {
    const ps = extra.per_serve_protein_g;
    const cs = extra.per_serve_carbs_g;
    if (typeof ps === "number" && typeof cs === "number") {
      extra.per_serve_protein_g = cs;
      extra.per_serve_carbs_g = ps;
    }
    extra.nutrition_corrected = "protein_carbs_swap";
    next.extra = extra;
  }
  return next;
}

/** Energy column too low while macros look like per-100g (common pack-scale bug). */
function tryFixLowEnergy(
  nutrition: ProductNutrition,
  ctx: NutritionContext,
): ProductNutrition | null {
  if (!isHighProteinCategory(ctx)) return null;
  const energy = nutrition.energy_kcal_100g;
  if (energy == null || energy >= 35) return null; // raised from 55 to match detection threshold

  const implied = impliedKcal(nutrition);
  const baseMismatch = kcalMismatchRatio(nutrition) ?? 1;
  let best: { n: ProductNutrition; mismatch: number } | null = null;

  for (const factor of [2, 100 / 30, 100 / 50, 100 / 40, 100 / 25, 100 / 35]) {
    const trial = {
      ...nutrition,
      energy_kcal_100g: Math.round(energy * factor),
    };
    const mismatch = kcalMismatchRatio(trial) ?? 1;
    if (mismatch < baseMismatch && (!best || mismatch < best.mismatch)) {
      best = { n: trial, mismatch };
    }
  }

  if (
    implied != null &&
    implied > energy * 1.35 &&
    (!best || implied / energy > 2)
  ) {
    const trial = { ...nutrition, energy_kcal_100g: Math.round(implied) };
    const mismatch = kcalMismatchRatio(trial) ?? 1;
    if (mismatch <= 0.35) {
      return {
        ...trial,
        extra: { ...nutrition.extra, nutrition_corrected: "energy_from_macros" },
      };
    }
  }

  if (best && best.mismatch <= 0.35) {
    return {
      ...best.n,
      extra: { ...nutrition.extra, nutrition_corrected: "energy_scaled" },
    };
  }

  return null;
}

/** Per-serve values stored as per-100g (e.g. 31 kcal for a 30g tofu serve). */
function tryScaleFromPerServe(
  nutrition: ProductNutrition,
  ctx: NutritionContext,
): ProductNutrition | null {
  if (!isHighProteinCategory(ctx)) return null;
  const energy = nutrition.energy_kcal_100g;
  if (energy == null || energy >= 35) return null; // raised from 55 to match detection threshold

  const baseMismatch = kcalMismatchRatio(nutrition) ?? 1;
  let best: { n: ProductNutrition; mismatch: number } | null = null;

  for (const factor of [2, 100 / 30, 100 / 50, 100 / 40, 100 / 25, 100 / 35, 100 / 60]) {
    let trial: ProductNutrition = { ...nutrition };
    for (const key of MACRO_KEYS) {
      trial = scaleMacro(trial, key, factor);
    }
    if (typeof trial.energy_kcal_100g === "number") {
      trial = {
        ...trial,
        energy_kcal_100g: Math.round(trial.energy_kcal_100g * factor),
      };
    }
    if (nutritionHasCriticalAnomalies(trial, ctx)) continue;
    const mismatch = kcalMismatchRatio(trial) ?? 1;
    if (mismatch <= baseMismatch && (!best || mismatch < best.mismatch)) {
      best = { n: trial, mismatch };
    }
  }

  if (!best) return null;
  return {
    ...best.n,
    extra: {
      ...best.n.extra,
      nutrition_corrected: "per_serve_to_per_100g",
    },
  };
}

export function tryCorrectNutrition(
  nutrition: ProductNutrition,
  ctx: NutritionContext,
): ProductNutrition | null {
  if (nutritionReviewStatus(nutrition)) return nutrition;
  if (!nutritionHasCriticalAnomalies(nutrition, ctx)) return nutrition;

  const lowEnergyFixed = tryFixLowEnergy(nutrition, ctx);
  if (lowEnergyFixed && !nutritionHasCriticalAnomalies(lowEnergyFixed, ctx)) {
    return lowEnergyFixed;
  }

  const perServeScaled = tryScaleFromPerServe(nutrition, ctx);
  if (perServeScaled && !nutritionHasCriticalAnomalies(perServeScaled, ctx)) {
    return perServeScaled;
  }

  // Try a column swap first — fast, common, often the right answer
  const swapAnomalies = detectNutritionAnomalies(nutrition, ctx);
  if (swapAnomalies.some((a) => a.code === "protein_carbs_swap")) {
    const swapped = swapProteinCarbs(nutrition);
    if (!nutritionHasCriticalAnomalies(swapped, ctx)) {
      return swapped;
    }
  }

  const baseMismatch = kcalMismatchRatio(nutrition) ?? 1;
  type Candidate = { n: ProductNutrition; mismatch: number; critical: boolean };
  const candidates: Candidate[] = [];

  if (macroSum(nutrition) > MAX_MACRO_MASS_G) {
    for (const factor of [0.1, 0.01] as const) {
      let trial = nutrition;
      for (const key of MACRO_KEYS) trial = scaleMacro(trial, key, factor);
      const critical = nutritionHasCriticalAnomalies(trial, ctx);
      const mismatch = kcalMismatchRatio(trial) ?? 1;
      if (!critical && mismatch <= baseMismatch) {
        candidates.push({ n: trial, mismatch, critical });
      }
    }
  }

  const divisors = [1, 0.1, 0.01] as const;
  for (const pDiv of divisors) {
    for (const cDiv of divisors) {
      for (const fDiv of divisors) {
        if (pDiv === 1 && cDiv === 1 && fDiv === 1) continue;
        if (
          isHighProteinCategory(ctx) &&
          pDiv < 1 &&
          typeof nutrition.protein_g_100g === "number" &&
          nutrition.protein_g_100g * pDiv < 4
        ) {
          continue;
        }
        let trial = nutrition;
        if (pDiv !== 1) trial = scaleMacro(trial, "protein_g_100g", pDiv);
        if (cDiv !== 1) trial = scaleMacro(trial, "carbs_g_100g", cDiv);
        if (fDiv !== 1) trial = scaleMacro(trial, "fat_g_100g", fDiv);
        const critical = nutritionHasCriticalAnomalies(trial, ctx);
        const mismatch = kcalMismatchRatio(trial) ?? 1;
        if (!critical && mismatch <= baseMismatch) {
          candidates.push({ n: trial, mismatch, critical });
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.mismatch - b.mismatch);
  const best = candidates[0].n;
  return {
    ...best,
    extra: {
      ...best.extra,
      nutrition_corrected: "decimal_scale",
    },
  };
}

export function sanitizeNutrition(
  nutrition: ProductNutrition | null | undefined,
  ctx: NutritionContext,
): ProductNutrition | null {
  if (!nutrition) return null;
  if (nutritionReviewStatus(nutrition)) return nutrition;

  const corrected = tryCorrectNutrition(nutrition, ctx) ?? nutrition;
  const criticalAnomalies = detectNutritionAnomalies(corrected, ctx).filter(
    (a) => a.severity === "critical",
  );

  // If rules flag this as critical, mark it for LLM review rather than silently discarding.
  // The async sanitizeNutritionWithLlm() is the authoritative version for API routes.
  // This sync version is a conservative fallback: return data with anomaly flags attached
  // so it surfaces in the UI rather than being silently hidden.
  if (criticalAnomalies.length > 0) {
    return {
      ...corrected,
      extra: {
        ...corrected.extra,
        nutrition_anomalies: JSON.stringify(criticalAnomalies),
        needs_llm_review: "1",
      },
    };
  }

  const allAnomalies = detectNutritionAnomalies(corrected, ctx);
  if (!allAnomalies.length) return corrected;

  return {
    ...corrected,
    extra: {
      ...corrected.extra,
      nutrition_anomalies: JSON.stringify(allAnomalies),
    },
  };
}

/**
 * Async version of sanitizeNutrition that uses DeepSeek to validate before discarding.
 * Use this in API routes where async is possible. Falls back to sync version on error.
 */
export async function sanitizeNutritionWithLlm(
  nutrition: ProductNutrition | null | undefined,
  ctx: NutritionContext,
  cacheKey?: string,
): Promise<ProductNutrition | null> {
  if (!nutrition) return null;
  if (nutritionReviewStatus(nutrition)) return nutrition;

  const corrected = tryCorrectNutrition(nutrition, ctx) ?? nutrition;
  const criticalAnomalies = detectNutritionAnomalies(corrected, ctx).filter(
    (a) => a.severity === "critical",
  );

  if (criticalAnomalies.length > 0) {
    // Ask LLM before discarding
    const { isNutritionPlausibleViaLlm } = await import("@/lib/nutrition/llm-validate");
    const plausible = await isNutritionPlausibleViaLlm(corrected, ctx, criticalAnomalies, cacheKey);

    if (!plausible) {
      // LLM confirms it's bad — discard
      return null;
    }

    // LLM says keep it — return with anomaly flags so UI can show context
    return {
      ...corrected,
      extra: {
        ...corrected.extra,
        nutrition_anomalies: JSON.stringify(criticalAnomalies),
        llm_validated: "1",
      },
    };
  }

  const allAnomalies = detectNutritionAnomalies(corrected, ctx);
  if (!allAnomalies.length) return corrected;

  return {
    ...corrected,
    extra: {
      ...corrected.extra,
      nutrition_anomalies: JSON.stringify(allAnomalies),
    },
  };
}
