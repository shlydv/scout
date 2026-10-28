import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NutritionFactsTable } from "../components/nutrition-facts-table";
import { PdpNutritionGlance } from "../components/pdp-nutrition-glance";
import { canScoreReviewedNutrition, nutritionReviewSnapshot, nutritionReviewStatus } from "../lib/nutrition/review";
import { buildOverallGoalSummary, buildProductGoalRows } from "../lib/goals/build-goal-rows";
import { analyzeBasket, computeSwapImpact } from "../lib/products/basket-analysis";
import { findAlternatives, findSimilarProducts } from "../lib/products/alternatives";
import type { ProductListItem } from "../lib/products/queries";
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
test("two-decimal normalization may total 100.01g but a 101g panel is still rejected", () => {
  const manna = { protein_g_100g: 6.67, carbs_g_100g: 86.67, fat_g_100g: 6.67, energy_kcal_100g: 433.39 };
  const product = { name: "Manna rice mix", category: "Breakfast" };
  assert.equal(detectNutritionAnomalies(manna, product).some(a => a.code === "macro_mass_exceeds_100g"), false);
  assert.deepEqual(tryCorrectNutrition(manna, product), manna);
  const impossible = reviewed({ protein_g_100g: 7, carbs_g_100g: 87, fat_g_100g: 7, energy_kcal_100g: 439 });
  assert.ok(detectNutritionAnomalies(impossible, product).some(a => a.code === "macro_mass_exceeds_100g" && a.severity === "critical"));
});
test("partial and conflicting panels explain why values and scores are withheld", () => {
  const partial = renderToStaticMarkup(createElement(NutritionFactsTable, { nutrition: reviewed({ protein_g_100g: 27.27 }, "partial") }));
  assert.match(partial, /Only verified values are shown/);
  assert.match(partial, /no score is available/);
  const conflict = renderToStaticMarkup(createElement(NutritionFactsTable, { nutrition: reviewed({}, "label_conflict") }));
  assert.match(conflict, /Available labels disagree/);
  assert.match(conflict, /Nutrition values and a score are withheld/);
  const emptyPartial = renderToStaticMarkup(createElement(NutritionFactsTable, { nutrition: reviewed({}, "partial") }));
  assert.match(emptyPartial, /Label verification is incomplete/);
  assert.doesNotMatch(emptyPartial, /No nutrition values on file yet/);
  const emptyPdp = renderToStaticMarkup(createElement(PdpNutritionGlance, { nutrition: reviewed({}, "label_conflict"), name: "Conflicting labels" }));
  assert.match(emptyPdp, /Available labels disagree/);
  const partialPdp = renderToStaticMarkup(createElement(PdpNutritionGlance, { nutrition: reviewed({ protein_g_100g: 27.27 }, "partial"), name: "Partially verified label" }));
  assert.match(partialPdp, /Nutrition is under review/);
  assert.doesNotMatch(partialPdp, /do not infer/);
});
test("missing evidence and stale booleans do not authorize bypass", () => {
  assert.equal(nutritionReviewStatus({ ...jerky, extra: { manual_review_status: "verified" } }), null);
  assert.equal(nutritionReviewStatus({ ...jerky, extra: { ...jerky.extra, manual_review_sources: "[]" } }), null);
});


test("reviewed panels missing sugar or sodium cannot regain a score", async () => {
  const { hasScoreableNutrition } = await import("../lib/scoring/persist-core");
  assert.equal(hasScoreableNutrition(jerky), false);
  assert.equal(hasScoreableNutrition(reviewed({ protein_g_100g: 1, carbs_g_100g: 2 }, "partial")), false);
  assert.equal(hasScoreableNutrition(reviewed({ energy_kcal_100g: 350, protein_g_100g: 10, carbs_g_100g: 50, fat_g_100g: 10, sugar_g_100g: 5, sodium_mg_100g: 100 })), true);
});
test("explicit mass-based serving wins over stale computed default", async () => {
  const { resolveServingGrams } = await import("../lib/scoring/serving");
  assert.deepEqual(resolveServingGrams({ nutrition: { extra: { serving_size_g: 25, serving_size_unit: "g", serving_size_value: 3.2 } } }), { serving_g: 3.2, source: "label_extra" });
  assert.notEqual(resolveServingGrams({ nutrition: { extra: { serving_size_unit: "ml", serving_size_value: 65 } }, name: "Ice Cream" }).serving_g, 65);
});

function product(nutrition: ProductNutrition, score: number | null, id = "cookie"): ProductListItem {
  return { id, slug: id, name: "Rice cookies " + id, brand: id, category: "Biscuits", subcategory: "Cookies", l3: "Cookies", nutrition, core_scores: score == null ? null : { score, verdict: "buy" }, ingredients_raw: "Rice", attributes: null, price_inr: 50, net_weight: "100 g", image_urls: [] } as unknown as ProductListItem;
}
const complete = { energy_kcal_100g: 350, protein_g_100g: 10, carbs_g_100g: 50, fat_g_100g: 10, sugar_g_100g: 5, sodium_mg_100g: 100 };
test("reviewed incomplete or unscored panels cannot regain PDP goal scores", () => {
  for (const p of [product(reviewed(complete, "partial"), 80), product(reviewed(complete, "label_conflict"), 80), product(reviewed(complete), null), product(jerky, 80)]) {
    assert.equal(canScoreReviewedNutrition(p), false);
    assert.deepEqual(buildProductGoalRows(p), []);
    assert.equal(buildOverallGoalSummary(p), null);
  }
  assert.equal(canScoreReviewedNutrition(product(reviewed(complete), 70)), true);
  assert.ok(buildProductGoalRows(product(reviewed(complete), 70)).length > 0);
  assert.equal(canScoreReviewedNutrition(product({}, null)), true, "existing unreviewed behavior remains unchanged");
});
test("basket aggregates exclude reviewed incomplete panels without treating missing macros as zero", () => {
  const good = product(reviewed(complete), 70, "good");
  const held = product(reviewed({ protein_g_100g: 90, sugar_g_100g: 90 }, "partial"), 99, "held");
  const control = analyzeBasket([{ product: good, qty: 1 }], "gym");
  const mixed = analyzeBasket([{ product: good, qty: 1 }, { product: held, qty: 2 }], "gym");
  assert.equal(mixed.itemCount, 3);
  assert.equal(mixed.totalInr, 150);
  for (const key of ["avgCoreScore", "avgGoalFit", "proteinPct", "avgSugarG", "avgFiberG", "snackHeavyPct"] as const) assert.equal(mixed[key], control[key], key);
  assert.match(mixed.summary.join(" "), /excluded/);
  const onlyHeld = analyzeBasket([{ product: held, qty: 1 }], "gym");
  assert.equal(onlyHeld.avgGoalFit, null);
  assert.equal(onlyHeld.avgCoreScore, null);
  assert.equal(onlyHeld.proteinPct, null);
  assert.equal(onlyHeld.avgSugarG, null);
});
test("swap rankings and impact never assign derived scores to reviewed incomplete candidates", () => {
  const good = product(reviewed(complete), 70, "good");
  const held = product(reviewed(complete, "partial"), 99, "held");
  assert.deepEqual(findAlternatives(good, [held], "gym"), []);
  assert.deepEqual(findAlternatives(held, [good], "gym"), []);
  assert.deepEqual(findSimilarProducts(good, [held], "gym"), []);
  const swaps = { held: [{ product: good }] } as unknown as Parameters<typeof computeSwapImpact>[1];
  const impact = computeSwapImpact([{ product: held, qty: 1 }], swaps)!;
  assert.equal(impact.scoreNow, null);
  assert.equal(impact.sugarNowG, null);
  assert.equal(impact.scoreAfter, 70);
});

test('volume labels preserve their basis, servings and packs without gram-based scoring or thresholds', async () => {
  const { resolveNutritionDisplay } = await import('../lib/nutrition/nutrition-display');
  const { judgeNutrientRow } = await import('../lib/nutrition/nutrient-judgment');
  const { parsePackGrams } = await import('../lib/products/pack-nutrition');
  const { parseServingSizeGrams } = await import('../lib/ocr/serving-size-grams');
  const { hasScoreableNutrition } = await import('../lib/scoring/persist-core');
  const n=reviewed({ energy_kcal_100ml: 80, protein_g_100ml: 2, carbs_g_100ml: 18 });
  n.extra!.serving_size_ml=65;
  const display=resolveNutritionDisplay(n,'5 x 65 ml');
  assert.equal(display.basisUnit,'ml'); assert.equal(display.serveG,null);
  assert.equal(display.serveQuantity,65); assert.equal(display.packGrams,null);
  const energy=display.rows.find(r=>r.id==='energy_kcal_100g')!;
  assert.equal(energy.perServe,52); assert.equal(energy.perPack,260);
  assert.equal(judgeNutrientRow(energy),null); assert.equal(hasScoreableNutrition(n),false);
  assert.equal(parsePackGrams('1 L'),null); assert.equal(parsePackGrams('2 x 50 ml'),null);
  assert.equal(parsePackGrams('2 x 50 g'),100);
  assert.equal(parseServingSizeGrams('65 ml'),null); assert.equal(parseServingSizeGrams('65 ml (70 g)'),70);
  const html=renderToStaticMarkup(createElement(NutritionFactsTable,{nutrition:n,netWeight:'5 x 65 ml'}));
  assert.match(html,/Per 100ml/); assert.match(html,/65ml/); assert.doesNotMatch(html,/Per 100g|65g/);
  assert.equal(resolveNutritionDisplay(n,'200 g').hasPack,false);
  const changed={...n,protein_g_100ml:3};assert.equal(nutritionReviewStatus(changed),null);
});

test("small declared nonzero quantities never render as exact zero", async () => {
  const {formatNutrientValue}=await import("../lib/nutrition/nutrition-display");
  assert.equal(formatNutrientValue(0),"0");
  assert.equal(formatNutrientValue(0.003),"0.003");
  assert.equal(formatNutrientValue(0.00015),"0.00015");
});
