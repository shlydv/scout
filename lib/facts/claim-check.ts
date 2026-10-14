/**
 * Does a front-of-pack claim survive the product's own label? Search credits a
 * claim only when the panel or ingredient list backs it, never on the claim alone.
 *
 * Numeric limits follow FSSAI's nutrition-claim thresholds (per 100 g, or 100 ml
 * for liquids). Some claim ids merge "high" and "source of" wordings, so they are
 * checked against the lower "source" bar.
 */
import type { ConceptId } from "@/lib/facts/vocab";

export type ClaimStatus = "holds" | "contradicted" | "unverifiable";

export type ClaimEvidence = {
  nutrition: Record<string, number | string | null> | null;
  /** False when the nutrition panel failed plausibility checks; its numbers then prove nothing. */
  nutritionTrusted: boolean;
  present: string[];
  unknown: string[];
  /** Liquid packs (ml / l) use the per-100 ml limits. */
  liquid: boolean;
};

/** Claims that say an ingredient is absent: contradicted when the ingredient list has it. */
const FREE_FROM: Partial<Record<string, ConceptId[]>> = {
  gluten_free: ["gluten_source"],
  no_palm_oil: ["palm_oil"],
  no_added_sugar: ["added_sugar"],
  no_preservatives: ["preservative"],
  no_artificial_colours: ["artificial_colour"],
  no_artificial_flavours: ["artificial_flavour"],
  no_maida: ["refined_flour"],
  vegan: ["dairy", "egg", "honey", "meat", "fish_seafood", "gelatin"],
  jain: ["onion_garlic", "root_vegetable"],
};

/** Claims that say an ingredient is there: hold only when the ingredient list shows it. */
const CONTAINS: Partial<Record<string, ConceptId>> = {
  whole_grain: "whole_grain",
};

function num(n: ClaimEvidence["nutrition"], key: string): number | null {
  const v = n?.[key];
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function checkClaim(claim: string, ev: ClaimEvidence): ClaimStatus {
  const absentOf = FREE_FROM[claim];
  if (absentOf) {
    if (absentOf.some(c => ev.present.includes(c))) return "contradicted";
    return absentOf.some(c => ev.unknown.includes(c)) ? "unverifiable" : "holds";
  }
  const contains = CONTAINS[claim];
  if (contains) return ev.present.includes(contains) ? "holds" : "unverifiable";

  const panel = (key: string) => (ev.nutritionTrusted ? num(ev.nutrition, key) : null);
  const verdict = (value: number | null, ok: (v: number) => boolean): ClaimStatus =>
    value == null ? "unverifiable" : ok(value) ? "holds" : "contradicted";

  switch (claim) {
    case "sugar_free":
      return verdict(panel("sugar_g_100g"), v => v <= 0.5);
    case "low_fat":
      return verdict(panel("fat_g_100g"), v => v <= (ev.liquid ? 1.5 : 3));
    case "zero_trans_fat":
      return verdict(panel("trans_fat_g_100g"), v => v <= 0.2);
    case "high_fibre":
      return verdict(panel("fiber_g_100g"), v => v >= (ev.liquid ? 1.5 : 3));
    case "high_protein": {
      // Source of protein: at least 10% of energy from protein.
      const protein = panel("protein_g_100g"), kcal = panel("energy_kcal_100g");
      if (protein == null || kcal == null || kcal <= 0) return "unverifiable";
      return (protein * 4) / kcal >= 0.1 ? "holds" : "contradicted";
    }
    default:
      // Baked, organic, keto, kids… the label alone can't confirm or refute these.
      return "unverifiable";
  }
}

export function isLiquidPack(netWeight: string | null): boolean {
  return /\d\s*(ml|l|ltr|litre|liter)\b/i.test(netWeight ?? "");
}
