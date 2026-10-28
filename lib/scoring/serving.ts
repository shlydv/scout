import categoryServings from "@/data/category-servings.json";
import { parseServingSizeGrams, scalePer100gToServe } from "@/lib/ocr/serving-size-grams";
import { nutritionFromAttributes } from "@/lib/nutrition/sanity";
import { parsePackGrams } from "@/lib/products/pack-nutrition";
import type { ProductNutrition } from "@/lib/supabase/types";
import { inferRoleCohort, type RoleCohort } from "@/lib/scoring/role-cohort";

type ServingRule = {
  serving_g: number;
  name_regex?: string;
  category_regex?: string;
};

type ServingConfig = {
  fallback_g: number;
  by_role_cohort: Record<RoleCohort, number>;
  rules: ServingRule[];
};

const CONFIG = categoryServings as ServingConfig;

export type ServingResolution = {
  serving_g: number;
  source: "label_extra" | "structured" | "attributes" | "category_default" | "role_default" | "pack_weight";
};

export function resolveServingGrams(opts: {
  nutrition?: ProductNutrition | null;
  structuredServingSize?: string | null;
  attributes?: Record<string, string> | null;
  net_weight?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
}): ServingResolution {
  const extra = opts.nutrition?.extra ?? {};
  // Structured mass-based label servings outrank older computed defaults.
  // Never treat a volume serving as grams without an explicit mass conversion.
  const labelMass = extra.serving_size_unit === "g" && typeof extra.serving_size_value === "number"
    && Number.isFinite(extra.serving_size_value) && extra.serving_size_value > 0
    ? extra.serving_size_value : null;
  const fromExtra = labelMass ?? (
    typeof extra.serving_size_g === "number"
      ? extra.serving_size_g
      : parseServingSizeGrams(
          typeof extra.serving_size === "string" ? extra.serving_size : null,
        ));
  if (fromExtra != null && fromExtra > 0) {
    return { serving_g: fromExtra, source: "label_extra" };
  }

  const fromStructured = parseServingSizeGrams(opts.structuredServingSize);
  if (fromStructured != null) {
    return { serving_g: fromStructured, source: "structured" };
  }

  const attrNut = nutritionFromAttributes(opts.attributes ?? null);
  const attrServe =
    typeof attrNut?.extra?.serving_size_g === "number"
      ? attrNut.extra.serving_size_g
      : parseServingSizeGrams(
          typeof attrNut?.extra?.serving_size === "string"
            ? attrNut.extra.serving_size
            : null,
        );
  if (attrServe != null && attrServe > 0) {
    return { serving_g: attrServe, source: "attributes" };
  }

  const name = opts.name ?? "";
  const catHay = `${opts.category ?? ""} ${opts.subcategory ?? ""}`;
  for (const rule of CONFIG.rules) {
    if (rule.name_regex && new RegExp(rule.name_regex, "i").test(name)) {
      return { serving_g: rule.serving_g, source: "category_default" };
    }
    if (rule.category_regex && new RegExp(rule.category_regex, "i").test(catHay)) {
      return { serving_g: rule.serving_g, source: "category_default" };
    }
  }

  const role = inferRoleCohort({
    name: opts.name,
    category: opts.category,
    subcategory: opts.subcategory,
  });
  const roleG = CONFIG.by_role_cohort[role] ?? CONFIG.fallback_g;
  if (roleG !== CONFIG.fallback_g) {
    return { serving_g: roleG, source: "role_default" };
  }

  const packG = parsePackGrams(opts.net_weight);
  if (packG != null && packG > 0 && packG <= 500) {
    return { serving_g: packG, source: "pack_weight" };
  }

  return { serving_g: CONFIG.fallback_g, source: "role_default" };
}

export type PerServeNutrition = {
  serving_g: number;
  serving_source: ServingResolution["source"];
  energy_kcal?: number;
  protein_g?: number;
  fat_g?: number;
  saturated_fat_g?: number;
  trans_fat_g?: number;
  carbs_g?: number;
  sugar_g?: number;
  added_sugar_g?: number;
  fiber_g?: number;
  sodium_mg?: number;
  calcium_mg?: number;
};

const PER_SERVE_KEYS: Array<{
  per100: keyof ProductNutrition;
  perServe: keyof PerServeNutrition;
}> = [
  { per100: "energy_kcal_100g", perServe: "energy_kcal" },
  { per100: "protein_g_100g", perServe: "protein_g" },
  { per100: "fat_g_100g", perServe: "fat_g" },
  { per100: "saturated_fat_g_100g", perServe: "saturated_fat_g" },
  { per100: "trans_fat_g_100g", perServe: "trans_fat_g" },
  { per100: "carbs_g_100g", perServe: "carbs_g" },
  { per100: "sugar_g_100g", perServe: "sugar_g" },
  { per100: "added_sugar_g_100g", perServe: "added_sugar_g" },
  { per100: "fiber_g_100g", perServe: "fiber_g" },
  { per100: "sodium_mg_100g", perServe: "sodium_mg" },
  { per100: "calcium_mg_100g", perServe: "calcium_mg" },
];

/** Attach per-serve values into nutrition.extra for scoring V9. */
export function attachPerServeNutrition(
  nutrition: ProductNutrition | null,
  opts: {
    structuredServingSize?: string | null;
    attributes?: Record<string, string> | null;
    net_weight?: string | null;
    name?: string | null;
    category?: string | null;
    subcategory?: string | null;
  },
): { nutrition: ProductNutrition | null; perServe: PerServeNutrition | null } {
  if (!nutrition) return { nutrition: null, perServe: null };

  const serving = resolveServingGrams({
    nutrition,
    ...opts,
  });
  const g = serving.serving_g;
  const perServe: PerServeNutrition = {
    serving_g: g,
    serving_source: serving.source,
  };

  for (const { per100, perServe: key } of PER_SERVE_KEYS) {
    const v = nutrition[per100];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const scaled = scalePer100gToServe(v, g);
    if (scaled == null) continue;
    switch (key) {
      case "energy_kcal":
        perServe.energy_kcal = scaled;
        break;
      case "protein_g":
        perServe.protein_g = scaled;
        break;
      case "fat_g":
        perServe.fat_g = scaled;
        break;
      case "saturated_fat_g":
        perServe.saturated_fat_g = scaled;
        break;
      case "trans_fat_g":
        perServe.trans_fat_g = scaled;
        break;
      case "carbs_g":
        perServe.carbs_g = scaled;
        break;
      case "sugar_g":
        perServe.sugar_g = scaled;
        break;
      case "added_sugar_g":
        perServe.added_sugar_g = scaled;
        break;
      case "fiber_g":
        perServe.fiber_g = scaled;
        break;
      case "sodium_mg":
        perServe.sodium_mg = scaled;
        break;
      case "calcium_mg":
        perServe.calcium_mg = scaled;
        break;
    }
  }

  const extra: Record<string, number | string> = {
    ...(nutrition.extra ?? {}),
    serving_size_g: g,
    per_serve_basis: "computed_v9",
    serving_resolution: serving.source,
  };
  if (perServe.energy_kcal != null) extra.per_serve_energy_kcal = perServe.energy_kcal;
  if (perServe.protein_g != null) extra.per_serve_protein_g = perServe.protein_g;
  if (perServe.fat_g != null) extra.per_serve_fat_g = perServe.fat_g;
  if (perServe.carbs_g != null) extra.per_serve_carbs_g = perServe.carbs_g;
  if (perServe.sugar_g != null) extra.per_serve_sugar_g = perServe.sugar_g;
  if (perServe.fiber_g != null) extra.per_serve_fiber_g = perServe.fiber_g;
  if (perServe.sodium_mg != null) extra.per_serve_sodium_mg = perServe.sodium_mg;

  return {
    nutrition: { ...nutrition, extra },
    perServe,
  };
}
