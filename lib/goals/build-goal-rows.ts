import { computeGoalFit, goalFitInputs } from "@/lib/goals/fit";
import { canScoreReviewedNutrition } from "@/lib/nutrition/review";
import { GOAL_PROFILES, type GoalId } from "./types";

export type GoalFitRow = {
  id: GoalId;
  label: string;
  fit: number;
  reasons: string[];
  primaryMetric: string;
  shortReason: string;
};
import type { ProductListItem } from "@/lib/products/queries";
import { gradeFromScore, type Grade } from "@/lib/utils";

const PDP_GOAL_ORDER: GoalId[] = [
  "gym",
  "protein-budget",
  "bulk",
  "fat-loss",
  "diabetic",
  "pcos",
  "kids",
  "parents",
  "balanced",
];

export function buildProductGoalRows(
  product: Pick<
    ProductListItem,
    | "nutrition"
    | "ingredients_raw"
    | "price_inr"
    | "net_weight"
    | "name"
    | "category"
    | "subcategory"
    | "core_scores"
    | "attributes"
  >,
): GoalFitRow[] {
  if (!canScoreReviewedNutrition(product)) return [];
  const inputs = goalFitInputs(product);
  return PDP_GOAL_ORDER.map((id) => {
    const profile = GOAL_PROFILES.find((g) => g.id === id)!;
    const result = computeGoalFit(id, inputs);
    return {
      id,
      label: profile.label,
      fit: result.fit,
      reasons: result.reasons,
      primaryMetric: result.primaryMetric,
      shortReason: result.shortReason,
    };
  });
}

export function buildOverallGoalSummary(
  product: Pick<ProductListItem, "core_scores" | "nutrition" | "ingredients_raw">,
): { fit: number; grade: Grade; reasons: string[] } | null {
  if (!canScoreReviewedNutrition(product)) return null;
  const score = product.core_scores?.score;
  if (score == null) return null;
  const reasons: string[] = [];
  if (product.nutrition?.protein_g_100g != null && product.nutrition.protein_g_100g >= 15) {
    reasons.push(`${product.nutrition.protein_g_100g}g protein per 100g`);
  }
  const sugar =
    product.nutrition?.sugar_g_100g ?? product.nutrition?.added_sugar_g_100g;
  if (typeof sugar === "number") {
    reasons.push(sugar <= 8 ? `Low sugar (${sugar}g)` : `${sugar}g sugar per 100g`);
  }
  if (reasons.length === 0) {
    reasons.push("Based on label nutrition, ingredients, and additives");
  }
  return {
    fit: score,
    grade: gradeFromScore(score),
    reasons,
  };
}
