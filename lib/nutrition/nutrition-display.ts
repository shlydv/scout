import { parsePack } from "@/lib/facts/pack";
import { formatPackLabel, parsePackGrams, scaleFromPer100g } from "@/lib/products/pack-nutrition";
import { perServeFromNutrition } from "@/lib/scoring/per-serve";
import type { PerServeNutrition } from "@/lib/scoring/serving";
import type { ProductNutrition } from "@/lib/supabase/types";

export type NutritionRowDef = {
  key: keyof ProductNutrition;
  perServeField: keyof PerServeNutrition | null;
  label: string;
  unit: string;
  emphasis?: boolean;
  /** Sub-row: still show when the parent macro is on the label. */
  parentKey?: keyof ProductNutrition;
};

/** FSSAI-style order — macros first, then sub-components, then minerals. */
export const NUTRITION_ROW_DEFS: NutritionRowDef[] = [
  { key: "energy_kcal_100g", perServeField: "energy_kcal", label: "Energy", unit: "kcal", emphasis: true },
  { key: "protein_g_100g", perServeField: "protein_g", label: "Protein", unit: "g", emphasis: true },
  { key: "carbs_g_100g", perServeField: "carbs_g", label: "Carbohydrates", unit: "g", emphasis: true },
  { key: "sugar_g_100g", perServeField: "sugar_g", label: "Total sugars", unit: "g", parentKey: "carbs_g_100g" },
  { key: "added_sugar_g_100g", perServeField: "added_sugar_g", label: "Added sugars", unit: "g", parentKey: "carbs_g_100g" },
  { key: "fiber_g_100g", perServeField: "fiber_g", label: "Dietary fibre", unit: "g", parentKey: "carbs_g_100g" },
  { key: "fat_g_100g", perServeField: "fat_g", label: "Total fat", unit: "g", emphasis: true },
  { key: "saturated_fat_g_100g", perServeField: "saturated_fat_g", label: "Saturated fat", unit: "g", parentKey: "fat_g_100g" },
  { key: "trans_fat_g_100g", perServeField: "trans_fat_g", label: "Trans fat", unit: "g", parentKey: "fat_g_100g" },
  { key: "sodium_mg_100g", perServeField: "sodium_mg", label: "Sodium", unit: "mg", emphasis: true },
  { key: "calcium_mg_100g", perServeField: "calcium_mg", label: "Calcium", unit: "mg" },
  { key: "iron_mg_100g", perServeField: null, label: "Iron", unit: "mg" },
  { key: "potassium_mg_100g", perServeField: null, label: "Potassium", unit: "mg" },
  { key: "cholesterol_mg_100g", perServeField: null, label: "Cholesterol", unit: "mg" },
  { key: "caffeine_mg_100g", perServeField: null, label: "Caffeine", unit: "mg" },
];

export type ResolvedNutritionRow = {
  id: string;
  label: string;
  unit: string;
  emphasis: boolean;
  indent: boolean;
  basisUnit?: "g" | "ml";
  per100: number | undefined;
  perServe: number | undefined;
  perPack: number | undefined;
};

export type NutritionDisplayContext = {
  basisUnit: "g" | "ml";
  serveQuantity: number | null;
  rows: ResolvedNutritionRow[];
  hasServe: boolean;
  serveG: number | null;
  hasPack: boolean;
  packGrams: number | null;
  packLabel: string;
};

export function formatNutrientValue(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v === 0) return "0";
  if (v > 0 && v < 0.01) return v.toLocaleString("en-IN", { maximumSignificantDigits: 2 });
  if (v < 0.1) return v.toFixed(2).replace(/\.?0+$/, "");
  if (v < 10) return v.toFixed(1).replace(/\.0$/, "");
  return Math.round(v).toString();
}

function perServeValue(
  per100: number | undefined,
  perServe: PerServeNutrition | null,
  field: keyof PerServeNutrition | null,
): number | undefined {
  if (field && perServe) {
    const v = perServe[field];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  const servingG = perServe?.serving_g;
  if (per100 != null && servingG != null && servingG > 0) {
    return scaleFromPer100g(per100, servingG);
  }
  return undefined;
}

function perPackValue(
  per100: number | undefined,
  packGrams: number | null,
): number | undefined {
  if (per100 == null || packGrams == null || packGrams <= 0) return undefined;
  return scaleFromPer100g(per100, packGrams);
}

function rowHasData(
  def: NutritionRowDef,
  nutrition: ProductNutrition,
  perServe: PerServeNutrition | null,
  packGrams: number | null,
): boolean {
  const per100 = nutrition[def.key] as number | undefined;
  const ps = perServeValue(per100, perServe, def.perServeField);
  const pack = perPackValue(per100, packGrams);

  if (per100 != null || ps != null || pack != null) return true;

  if (def.parentKey != null && nutrition[def.parentKey] != null) return true;

  return false;
}

export function resolveNutritionDisplay(
  nutrition: ProductNutrition,
  netWeight?: string | null,
): NutritionDisplayContext {
  if (nutritionBasisUnit(nutrition) === "ml") {
    const pack = parsePack(netWeight);
    const ml = nutrition.extra?.serving_size_ml;
    const serving = typeof ml === "number" && Number.isFinite(ml) && ml > 0 ? ml : null;
    const packMl = pack?.unit === "ml" ? pack.qty : null;
    const rows = NUTRITION_ROW_DEFS.flatMap(def => {
      const value = nutrition[String(def.key).replace(/_100g$/, "_100ml") as keyof ProductNutrition];
      if (typeof value !== "number" || !Number.isFinite(value)) return [];
      return [{ id: def.key, label: def.label, unit: def.unit, emphasis: Boolean(def.emphasis), indent: def.parentKey != null,
        basisUnit: "ml" as const, per100: value, perServe: serving == null ? undefined : value * serving / 100,
        perPack: packMl == null ? undefined : value * packMl / 100 }];
    });
    return { rows, basisUnit: "ml", serveQuantity: serving, hasServe: serving != null, serveG: null,
      hasPack: packMl != null, packGrams: null, packLabel: netWeight?.trim() || "pack" };
  }
  const perServe = perServeFromNutrition(nutrition);
  const packGrams = parsePackGrams(netWeight);
  const packLabel = formatPackLabel(netWeight, packGrams);
  const serveG = perServe?.serving_g ?? null;
  const hasServe = serveG != null && serveG > 0;
  const hasPack = packGrams != null && packGrams > 0;

  const rows: ResolvedNutritionRow[] = NUTRITION_ROW_DEFS.filter((def) =>
    rowHasData(def, nutrition, perServe, packGrams),
  ).map((def) => {
    const per100 = nutrition[def.key] as number | undefined;
    return {
      id: def.key,
      label: def.label,
      unit: def.unit,
      emphasis: Boolean(def.emphasis),
      indent: def.parentKey != null,
      per100,
      perServe: perServeValue(per100, perServe, def.perServeField),
      perPack: perPackValue(per100, packGrams),
    };
  });

  return { rows, basisUnit: "g", serveQuantity: serveG, hasServe, serveG, hasPack, packGrams, packLabel };
}

/** Basis is explicit in field names; volume never silently becomes mass. */
export function nutritionBasisUnit(nutrition: ProductNutrition | null | undefined): "g" | "ml" {
  return Object.entries(nutrition ?? {}).some(([key,value]) => key.endsWith("_100ml") && typeof value === "number" && Number.isFinite(value)) ? "ml" : "g";
}
