import type { ProductNutrition } from "@/lib/supabase/types";

/** A review is tied to the actual nutrient values, not merely a durable boolean.
 * A subsequent import that changes any value invalidates the review automatically.
 * Only the evidence-backed repair workflow should write these metadata fields.
 */
export function nutritionReviewSnapshot(nutrition: ProductNutrition): string {
  return JSON.stringify(Object.entries(nutrition)
    .filter(([key]) => key !== "extra" && key !== "source")
    .sort(([a], [b]) => a.localeCompare(b)));
}

/** A review source is a public https page, or a reference to evidence we hold rather than a retailer URL:
 * "label-photo" (the pack photo on file), "retailer-listing" (a store's product listing), or
 * "scout-product:<uuid>" (a sibling product whose panel was reviewed). */
export function isReviewSource(source: string): boolean {
  return /^https:\/\//.test(source)
    || source === "label-photo"
    || source === "retailer-listing"
    || /^scout-product:[0-9a-f-]{36}$/.test(source);
}

export function nutritionReviewStatus(nutrition: ProductNutrition | null | undefined):
  "verified" | "partial" | "label_conflict" | null {
  if (!nutrition) return null;
  const extra = nutrition.extra;
  const status = extra?.manual_review_status;
  if (status !== "verified" && status !== "partial" && status !== "label_conflict") return null;
  if (extra?.manual_review_snapshot !== nutritionReviewSnapshot(nutrition)) return null;
  if (typeof extra.manual_review_sources !== "string" || typeof extra.manual_review_at !== "string") return null;
  try {
    const sources: unknown = JSON.parse(extra.manual_review_sources);
    if (!Array.isArray(sources) || !sources.length || !sources.every(s => typeof s === "string" && isReviewSource(s))) return null;
    if (!Number.isFinite(Date.parse(extra.manual_review_at))) return null;
  } catch { return null; }
  return status;
}

/** Reviewed panels must not acquire derived scores from missing-value defaults. */
export function canScoreReviewedNutrition(product: {
  nutrition: ProductNutrition | null;
  core_scores?: { score?: number | null } | null;
}): boolean {
  const status = nutritionReviewStatus(product.nutrition);
  if (!status) return true;
  if (status !== "verified" || typeof product.core_scores?.score !== "number" || !Number.isFinite(product.core_scores.score)) return false;
  return (["energy_kcal_100g", "protein_g_100g", "carbs_g_100g", "fat_g_100g", "sugar_g_100g", "sodium_mg_100g"] as const)
    .every(key => typeof product.nutrition?.[key] === "number" && Number.isFinite(product.nutrition[key]));
}
