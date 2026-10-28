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
    if (!Array.isArray(sources) || !sources.length || !sources.every(s => typeof s === "string" && /^https:\/\//.test(s))) return null;
    if (!Number.isFinite(Date.parse(extra.manual_review_at))) return null;
  } catch { return null; }
  return status;
}
