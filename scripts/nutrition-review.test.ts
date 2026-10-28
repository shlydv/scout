import assert from "node:assert/strict";
import { test } from "node:test";
import { nutritionReviewSnapshot, nutritionReviewStatus } from "../lib/nutrition/review";
import { detectNutritionAnomalies, sanitizeNutrition, sanitizeNutritionWithLlm, tryCorrectNutrition } from "../lib/nutrition/anomaly";
import { reconcileNutrition, reconcileNutritionWithLlm } from "../lib/nutrition/sanity";
import type { ProductNutrition } from "../lib/supabase/types";

const ctx = { name: "DOKi Tokyo Teriyaki Buffalo Jerky", category: "Munchies" };
function reviewed(n: ProductNutrition, status = "verified"): ProductNutrition {
  return { ...n, extra: { manual_review_status: status, manual_review_snapshot: nutritionReviewSnapshot(n), manual_review_sources: JSON.stringify(["https://dokifoods.com/products/tokyo-teriyaki-buffalo"]), manual_review_at: "2026-10-28T00:00:00Z" } };
}
const jerky = reviewed({ protein_g_100g: 50.93, carbs_g_100g: 16.7, fat_g_100g: 4.23, energy_kcal_100g: 306.47 });
test("evidence-backed protein is not swapped by category guesses", () => {
  assert.equal(nutritionReviewStatus(jerky), "verified");
  assert.deepEqual(tryCorrectNutrition(jerky, ctx), jerky);
  assert.equal(detectNutritionAnomalies(jerky, ctx).some(a => a.code === "protein_carbs_swap"), false);
});
test("sync and async reads preserve the same reviewed source despite stale attributes", async () => {
  const opts = { ...ctx, nutrition: jerky, attributes: { "Nutrition Information": "Per 100 g\nProtein: 16.7g\nCarbohydrate: 50.93g" } };
  assert.deepEqual(reconcileNutrition(opts), jerky);
  assert.deepEqual(await reconcileNutritionWithLlm(opts), jerky);
  assert.deepEqual(sanitizeNutrition(jerky, ctx), jerky);
  assert.deepEqual(await sanitizeNutritionWithLlm(jerky, ctx), jerky);
});
test("a changed nutrient invalidates the review", () => {
  assert.equal(nutritionReviewStatus({ ...jerky, protein_g_100g: 51 }), null);
  assert.equal(nutritionReviewStatus({ ...jerky, sodium_mg_100g: 123 }), null);
});
test("extra derived serving fields do not invalidate the nutrient snapshot", () => {
  assert.equal(nutritionReviewStatus({ ...jerky, extra: { ...jerky.extra, per_serve_protein_g: 15.28 } }), "verified");
});
test("partial reviews retain missing values and cannot receive scores", async () => {
  const partial = reviewed({ protein_g_100g: 27.27, carbs_g_100g: 57.79 }, "partial");
  assert.ok(detectNutritionAnomalies(partial, ctx).some(a => a.code === "manual_review_incomplete" && a.severity === "critical"));
  assert.deepEqual(await reconcileNutritionWithLlm({ ...ctx, nutrition: partial }), partial);
  assert.equal(partial.fat_g_100g, undefined);
});
test("verified metadata never hides physical impossibilities", () => {
  const bad = reviewed({ protein_g_100g: 120, carbs_g_100g: 30, fat_g_100g: 20 });
  assert.ok(detectNutritionAnomalies(bad, ctx).some(a => a.severity === "critical"));
});
test("missing evidence and stale booleans do not authorize bypass", () => {
  assert.equal(nutritionReviewStatus({ ...jerky, extra: { manual_review_status: "verified" } }), null);
  assert.equal(nutritionReviewStatus({ ...jerky, extra: { ...jerky.extra, manual_review_sources: "[]" } }), null);
});
