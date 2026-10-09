/** Offline contract tests for planned search (no network, no DB). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFacts, type FactsInput } from "@/lib/facts/extract";
import { parsePack, pricePer100 } from "@/lib/facts/pack";
import { CONCEPT_IDS } from "@/lib/facts/vocab";
import { confirm, scopeSize, widenScope, type PlannedItem } from "@/lib/search/planned/execute";
import { validatePlan, type SearchPlan } from "@/lib/search/planned/plan";
import { degradedPlan, diversify } from "@/lib/search/planned/search";
import type { CatalogVocabulary } from "@/lib/search/planned/vocabulary";

function vocab(): CatalogVocabulary {
  const nodes = [
    ["Biscuits", "Cookies", "Butter Biscuits", 40], ["Biscuits", "Wafers", "Wafers", 60],
    ["Munchies", "Chips & Crisps", "Wafers", 90], ["Munchies", "Chips & Crisps", "Chips", 500],
    ["Dairy, Bread & Eggs", "Indian Breads", "Fresh Chapati", 20],
  ] as const;
  const l3 = new Map(nodes.map(([category, subcategory, l3, count]) => [`${subcategory} > ${l3}`, { category, subcategory, l3, count }]));
  const l3Bare = new Map<string, string[]>();
  for (const k of l3.keys()) { const bare = k.split(" > ")[1]!.toLowerCase(); l3Bare.set(bare, [...(l3Bare.get(bare) ?? []), k]); }
  return {
    l3, l3Lower: new Map([...l3.keys()].map(k => [k.toLowerCase(), k])), l3Bare,
    subcategories: new Map(nodes.map(([c, s]) => [s, c])), categories: new Set(nodes.map(([c]) => c)),
    brands: [{ name: "Amul", lower: "amul", count: 300 }], rendered: "", loadedAt: Date.now(),
  };
}

const rawPlan = (over: Partial<Record<string, unknown>> = {}) => ({
  intent: "product", l3: [], subcategories: [], categories: [], brands: [], name_terms: [], require: [], exclude: [],
  strict: false, claims_required: [], claims_preferred: [], diet: {}, numeric: [], sort: { field: "relevance", dir: "asc" },
  semantic_query: "", judge: [], relax: [], comparison: null, summary: "", ...over,
}) as Parameters<typeof validatePlan>[0];

test("planner output is validated against the live vocabulary", () => {
  const { plan, dropped } = validatePlan(rawPlan({
    l3: ["Cookies > Butter Biscuits", "Wafers", "Imaginary > Thing"],
    brands: ["amul", "NotABrand"], exclude: ["gluten_source", "unicorn"],
    numeric: [{ field: "price_inr", op: "<=", value: 100 }, { field: "vibes", op: ">=", value: 1 }],
    sort: { field: "made_up", dir: "asc" },
  }), vocab(), []);
  assert.deepEqual(plan.l3.sort(), ["Chips & Crisps > Wafers", "Cookies > Butter Biscuits", "Wafers > Wafers"]);
  assert.deepEqual(plan.brands, ["Amul"]);
  assert.deepEqual(plan.exclude, ["gluten_source"]);
  assert.deepEqual(plan.numeric.map(n => n.field), ["price_inr"]);
  assert.deepEqual(plan.sort, { field: "relevance", dir: "desc" });
  assert.ok(dropped.includes("l3:Imaginary > Thing") && dropped.includes("brand:NotABrand") && dropped.includes("concept:unicorn"));
});

test("a scope name given at the wrong level maps to the l3 it names", () => {
  const { plan } = validatePlan(rawPlan({ subcategories: ["Fresh Chapati"] }), vocab(), []);
  assert.deepEqual(plan.l3, ["Indian Breads > Fresh Chapati"]);
});

test("pack sizes parse into g/ml/pcs and price per 100", () => {
  assert.deepEqual(parsePack("1 L"), { qty: 1000, unit: "ml" });
  assert.deepEqual(parsePack("6 x 200 ml"), { qty: 1200, unit: "ml" });
  assert.deepEqual(parsePack("66.6 or 75 g"), { qty: 66.6, unit: "g" });
  assert.deepEqual(parsePack("1 pack (450 g)"), { qty: 450, unit: "g" });
  assert.equal(parsePack("Pack of 2"), null);
  assert.equal(pricePer100(50, { qty: 250, unit: "g" }), 20);
});

const input: FactsInput = { id: "p1", name: "Test", brand: null, category_path: "x", ingredients_raw: "", label_claims: [] };
const raw = (over: Record<string, unknown>) => ({
  i: 0, ing_status: "complete", ingredients: [], present: {}, may_contain: [], unknown: {}, claims: [], claims_other: [],
  conflicts: [], veg: "veg", vegan: null, jain: null, kind: "", ...over,
}) as Parameters<typeof normalizeFacts>[1];

test("absence is only derived from complete ingredient lists", () => {
  const complete = normalizeFacts(input, raw({ ingredients: [["refined wheat flour", ["wheat", "refined_flour"]], ["potato", ["root_vegetable"]]] }));
  assert.equal(complete.concepts.wheat, "present");
  assert.equal(complete.concepts.gluten_source, "present", "wheat implies gluten_source");
  assert.equal(complete.concepts.palm_oil, "absent");
  assert.equal(complete.jain, false, "root vegetable rules out jain");
  const partial = normalizeFacts(input, raw({ ing_status: "partial", ingredients: [["sugar", ["added_sugar"]]] }));
  assert.equal(partial.concepts.palm_oil, "unknown");
  assert.equal(CONCEPT_IDS.filter(c => partial.concepts[c] === "absent").length, 0);
  const mayContain = normalizeFacts(input, raw({ may_contain: ["peanut"], unknown: { palm_oil: "edible vegetable oil" } }));
  assert.equal(mayContain.concepts.peanut, "may_contain");
  assert.equal(mayContain.concepts.palm_oil, "unknown");
  assert.equal(normalizeFacts(input, raw({ ingredients: [["chicken", ["meat"]]], veg: "veg" })).veg, "non_veg");
});

function item(over: Partial<PlannedItem> = {}): PlannedItem & { hasFacts?: boolean; nutritionOk?: boolean } {
  return {
    product_id: "p", slug: "p", name: "P", brand: "B", category: "c", subcategory: "s", l3: "l", price_inr: 50, net_weight: "100 g",
    scout_score: 50, nutrition: { sugar_g_100g: 3 }, kind: "", ingredients: [], claims: [], present: [], may_contain: [], unknown: [],
    conflicts: [], ingredient_status: "complete", veg: "veg", vegan: null, jain: null, price_per_100: 50, evidence: {},
    display: { image_urls: [], mrp_inr: null, ocr_image_url: null, primary_type: null, absolute_score: null, category_rank: null, category_size: null, category_label: null },
    similarity: 0.5, lexical: 0, confirmation: "confirmed", notes: [], score: 0.5, ...over,
  };
}
const plan = (over: Partial<SearchPlan> = {}): SearchPlan => ({ ...degradedPlan("q"), ...over });

test("unknown or missing evidence never confirms a constraint", () => {
  assert.equal(confirm(item(), plan({ exclude: ["palm_oil"] }), []).confirmation, "confirmed");
  assert.equal(confirm(item({ unknown: ["palm_oil"] }), plan({ exclude: ["palm_oil"] }), []).confirmation, "unconfirmed");
  assert.equal(confirm(item({ hasFacts: false }), plan({ exclude: ["palm_oil"] }), []).confirmation, "unconfirmed");
  assert.equal(confirm(item({ may_contain: ["peanut"] }), plan({ exclude: ["peanut"] }), []).confirmation, "confirmed", "may-contain warns when not strict");
  assert.equal(confirm(item({ nutrition: {} }), plan(), [{ field: "sugar_g", op: "<=", value: 5 }]).confirmation, "unconfirmed");
  assert.equal(confirm(item({ nutritionOk: false }), plan({ sort: { field: "protein_g", dir: "desc" } }), []).confirmation, "unconfirmed");
  assert.equal(confirm(item({ veg: "unknown" }), plan({ diet: { veg: true } }), []).confirmation, "unconfirmed");
});

test("scope widens one level at a time and never to the whole catalog", () => {
  const v = vocab();
  const p1 = widenScope(plan({ l3: ["Cookies > Butter Biscuits"] }), v)!;
  assert.deepEqual([p1.l3, p1.subcategories], [[], ["Cookies"]]);
  const p2 = widenScope(p1, v)!;
  assert.deepEqual([p2.subcategories, p2.categories], [[], ["Biscuits"]]);
  assert.equal(widenScope(p2, v), null);
  assert.equal(scopeSize(plan({ l3: ["Chips & Crisps > Chips"] }), v, true), 500);
  assert.equal(scopeSize(plan(), v, true), 710);
});

test("near-duplicate variants do not flood the top results", () => {
  const xs = ["Mango", "Vanilla", "Chocolate", "Kesar"].map(f => ({ brand: "Nakpro", name: `Nakpro Soy Protein Isolate ${f}` }));
  const out = diversify([...xs, { brand: "Other", name: "Other Whey" }]);
  assert.deepEqual(out.slice(0, 3).map(x => x.brand), ["Nakpro", "Nakpro", "Other"]);
  assert.equal(out.length, 5);
});
