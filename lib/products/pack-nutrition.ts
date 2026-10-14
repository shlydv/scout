import type { ProductNutrition } from "@/lib/supabase/types";
import { normalizeFormattedPacksize } from "@/lib/zepto/parse-formatted-packsize";

/** Parse pack size from net_weight (e.g. "50 g", "2 x 50 g", "1 kg", "1 L") → grams. */
export function parsePackGrams(netWeight: string | null | undefined): number | null {
  const normalized = normalizeFormattedPacksize(netWeight);
  if (!normalized?.trim()) return null;
  const s = normalized.toLowerCase().trim().replace(/,/g, "");

  const multi = s.match(
    /(\d+(?:\.\d+)?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(kg|kilogram|kilograms|g|gm|gram|grams|ml|l|ltr|litre|liter)\b/,
  );
  if (multi) {
    const count = parseFloat(multi[1]);
    const size = parseFloat(multi[2]);
    if (Number.isFinite(count) && Number.isFinite(size)) {
      return toGrams(size * count, multi[3]);
    }
  }

  const single = s.match(
    /(\d+(?:\.\d+)?)\s*(kg|kilogram|kilograms|g|gm|gram|grams|ml|l|ltr|litre|liter)\b/,
  );
  if (single) {
    const value = parseFloat(single[1]);
    if (Number.isFinite(value)) return toGrams(value, single[2]);
  }

  return null;
}

function toGrams(value: number, unit: string): number {
  if (unit.startsWith("kg") || unit.startsWith("kilo")) return value * 1000;
  if (unit === "l" || unit.startsWith("ltr") || unit.startsWith("lit")) return value * 1000;
  if (unit === "ml") return value;
  return value;
}

export function formatPackLabel(
  netWeight: string | null | undefined,
  packGrams: number | null,
): string {
  if (netWeight?.trim()) return netWeight.trim();
  if (packGrams != null && packGrams >= 1000) return `${packGrams / 1000} kg`;
  if (packGrams != null) return `${Math.round(packGrams)} g`;
  return "pack";
}

/** Scale a per-100g nutrient to the whole pack. */
export function scaleFromPer100g(per100g: number, packGrams: number): number {
  return (per100g * packGrams) / 100;
}

export function roundNutrient(value: number, unit: string): number {
  if (unit === "kcal") return Math.round(value);
  if (unit === "mg") return Math.round(value);
  return Math.round(value * 10) / 10;
}

export type PackNutritionContext = {
  packGrams: number | null;
  usesPack: boolean;
  proteinInPack: number | null;
  proteinPerRupee100: number | null;
};

export function packNutritionContext(opts: {
  nutrition: ProductNutrition | null;
  price_inr: number | null;
  net_weight: string | null | undefined;
}): PackNutritionContext {
  const protein100 = opts.nutrition?.protein_g_100g;
  const price = opts.price_inr ?? 0;
  const packGrams = parsePackGrams(opts.net_weight);

  if (typeof protein100 !== "number" || price <= 0) {
    return {
      packGrams,
      usesPack: false,
      proteinInPack: null,
      proteinPerRupee100: null,
    };
  }

  if (packGrams != null && packGrams > 0) {
    const proteinInPack = scaleFromPer100g(protein100, packGrams);
    return {
      packGrams,
      usesPack: true,
      proteinInPack,
      proteinPerRupee100: (proteinInPack / price) * 100,
    };
  }

  return {
    packGrams: null,
    usesPack: false,
    proteinInPack: null,
    proteinPerRupee100: (protein100 / price) * 100,
  };
}

/**
 * 0–100 goal fit for Protein / ₹ — dominated by grams protein per ₹100 spent.
 * (20 vs 40 g/₹100 should not both land at 99.)
 */
export function proteinBudgetGoalFit(opts: {
  proteinPerRupee100: number;
  protein_g_100g: number;
  core_score?: number | null;
}): number {
  const ppr = opts.proteinPerRupee100;
  const protein = opts.protein_g_100g;
  const core = opts.core_score ?? 50;

  const value = Math.min(82, ppr * 2.05);
  const density = Math.min(12, Math.max(0, (protein - 8) * 0.8));
  const quality = Math.min(6, Math.max(0, (core - 50) * 0.08));

  return Math.max(0, Math.min(100, Math.round(value + density + quality)));
}

/** Insights / catalog sort key — monotonic in protein per ₹100, then fit. */
export function proteinValueRankScore(opts: {
  proteinPerRupee100: number;
  protein_g_100g: number;
  core_score?: number | null;
}): number {
  const fit = proteinBudgetGoalFit(opts);
  return opts.proteinPerRupee100 * 100 + fit;
}
