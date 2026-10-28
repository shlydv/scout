/** Offline regression suite: no DB or external model calls. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { createShoppingContext, readShoppingContext } from "@/lib/shopping/context";
import { preserveRequirements, lockRequirements, sensitiveRequest } from "@/lib/shopping/policy";
import { productHref } from "@/lib/shopping/links";
import { degradedPlan } from "@/lib/search/planned/search";
import { confirm, type PlannedItem } from "@/lib/search/planned/execute";
import type { SearchPlan } from "@/lib/search/planned/plan";

process.env.SHOPPING_CONTEXT_SECRET = "offline-regression-secret";
function load(path: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): any {
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  runInNewContext(outputText, { exports, console: { error() {}, warn() {} }, process, Date, Buffer, URL, URLSearchParams, setTimeout: (fn: () => void) => { fn(); }, ...globals,
    require: (id: string) => { assert.ok(id in mocks, `Unexpected dependency: ${id}`); return mocks[id]; },
  }, { filename: path });
  return exports;
}
const plan = (over: Partial<SearchPlan> = {}): SearchPlan => ({ ...degradedPlan("cookies"), ...over });
const item = (id: string, over: Partial<PlannedItem> = {}): PlannedItem => ({
  product_id: id, slug: id, name: id, brand: "Test", category: "Biscuits", subcategory: "Cookies", l3: "Cookies",
  price_inr: 50, net_weight: "100 g", scout_score: 70, nutrition: { sugar_g_100g: 3 }, kind: "cookies", ingredients: ["rice"], claims: [], present: [], may_contain: [], unknown: [], conflicts: [], ingredient_status: "complete", veg: "veg", vegan: true, jain: true, price_per_100: 50, evidence: {}, variant_key: null,
  display: { image_urls: [], mrp_inr: null, ocr_image_url: null, primary_type: null, absolute_score: null, category_rank: null, category_size: null, category_label: null },
  similarity: 1, nutrition_trusted: true, lexical: 1, confirmation: "confirmed", notes: [], score: 1, ...over,
});

test("signed context rejects altered payloads, signatures, stale and oversized tokens", () => {
  const p = plan({ exclude: ["gluten_source"], strict: true });
  const token = createShoppingContext("cookies for celiac disease", p, 100);
  assert.equal(readShoppingContext(token, 101)?.plan.strict, true);
  const [payload, signature] = token.split(".");
  const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), plan: plan() })).toString("base64url");
  assert.equal(readShoppingContext(`${altered}.${signature}`, 101), null);
  assert.equal(readShoppingContext(`${payload}.fake`, 101), null);
  assert.equal(readShoppingContext(token, 8 * 86400_000), null);
  assert.equal(readShoppingContext("a".repeat(20001)), null);
});

test("explicit celiac/diet and saved ingredient/health requirements survive incomplete planner output", () => {
  const p = preserveRequirements(plan(), "gluten free cookies for celiac disease", { diet: "vegan", avoidIngredients: ["peanut", "palm oil"], healthContexts: ["diabetic"] });
  assert.equal(p.strict, true);
  assert.equal(p.diet.vegan, true);
  assert.deepEqual(p.exclude.sort(), ["gluten_source", "palm_oil", "peanut"]);
  assert.ok(p.judge.includes("Suitable for diabetic"));
  assert.equal(sensitiveRequest(p), true);
  const locked = lockRequirements({ ...p, relax: ["numeric:sugar_g", "claims_required", "scope", "brands"] }, "cookies");
  assert.deepEqual(locked.relax, ["scope", "brands"]);
});

test("current label evidence cannot confirm wheat, strict cross-contact, incomplete labels or out-of-range nutrition", () => {
  const p = plan({ exclude: ["gluten_source"], strict: true });
  for (const over of [{ present: ["gluten_source"] }, { may_contain: ["gluten_source"] }, { unknown: ["gluten_source"] }, { ingredient_status: "partial" }]) {
    assert.equal(confirm(item("bad", over as Partial<PlannedItem>), p, []).confirmation, "unconfirmed");
  }
  assert.equal(confirm(item("good"), p, []).confirmation, "confirmed");
  assert.equal(confirm(item("sugar", { nutrition: { sugar_g_100g: 25 } }), plan(), [{ field: "sugar_g", op: "<=", value: 5 }]).confirmation, "unconfirmed");
});

function searchHarness(p: SearchPlan, verdicts: Map<string, { v: string; why: string }>, plannerFails = false) {
  let executes = 0, verifies = 0;
  const api = load("lib/search/planned/search.ts", {
    "@/lib/search/embeddings": { isEmbeddingConfigured: () => false },
    "./db": { searchSql: () => ({}) },
    "./execute": { executePlan: async (_sql: unknown, safe: SearchPlan) => { executes++; assert.ok(!safe.relax.includes("numeric:sugar_g")); return { items: [item("one"), item("two")], relaxed: [], counts: [], reference: null, ms: 0 }; } },
    "./plan-cache": { planCacheKey: () => "key", getCachedPlan: async () => plannerFails ? null : { plan: p, dropped: [] }, storePlan() {} },
    "./plan": { plannerFingerprint: () => "fp", planQuery: async () => { throw new Error("planner offline"); } },
    "./verify": { needsVerification: () => false, verifyInChunks: async () => { verifies++; return { verdicts, usages: [], ms: 0, failedChunks: verdicts.size ? 0 : 1 }; } },
    "./vocabulary": { loadVocabulary: async () => ({}) },
    "@/lib/shopping/policy": { lockRequirements, preserveRequirements, sensitiveRequest },
  });
  return { api, counts: () => ({ executes, verifies }) };
}
test("planner outage fails closed before executing an unconstrained search", async () => {
  const h = searchHarness(plan(), new Map(), true);
  await assert.rejects(h.api.plannedSearch("gluten free biscuits for celiac disease"), /requirements could not be checked/);
  assert.equal(h.counts().executes, 0);
});
test("total verifier outage suppresses sensitive results even if verification is disabled", async () => {
  const h = searchHarness(plan({ strict: true, exclude: ["gluten_source"] }), new Map());
  const r = await h.api.plannedSearch("gluten free biscuits for celiac disease", { verify: false });
  assert.equal(r.items.length, 0);
  assert.equal(r.unconfirmed.length, 0);
  assert.equal(h.counts().verifies, 1);
  assert.match(r.summary, /could be confirmed/);
});
test("partial or malformed verifier output cannot leave unjudged medical results", async () => {
  const h = searchHarness(plan({ judge: ["suitable for diabetes"], numeric: [{ field: "sugar_g", op: "<=", value: 5 }], relax: ["numeric:sugar_g"] }), new Map([["one", { v: "good", why: "Low sugar" }]]));
  const r = await h.api.plannedSearch("biscuits for diabetes");
  assert.deepEqual(Array.from(r.items, (i: PlannedItem) => i.product_id), ["one"]);
});

function recommendationsHarness() {
  let executes = 0;
  let failVerifier = false;
  const api = load("lib/shopping/recommendations.ts", {
    "@/lib/search/planned/db": { searchSql: () => ({}) },
    "@/lib/search/planned/execute": { executePlan: async (_sql: unknown, p: SearchPlan, _vector: unknown, opts: any) => {
      executes++; assert.equal(opts.noRelax, true); assert.equal(p.relax.length, 0); assert.equal(p.l3.length, 0);
      assert.deepEqual(Array.from(opts.productIds), ["rice", "wheat", "cross-contact", "unknown"]);
      return { items: [item("rice"), item("wheat", { present: ["gluten_source"] }), item("cross-contact", { may_contain: ["gluten_source"] }), item("unknown", { unknown: ["gluten_source"] })].map(i => confirm(i, p, p.numeric)) };
    } },
    "@/lib/search/planned/plan": { planQuery: async () => { throw new Error("offline"); } },
    "@/lib/search/planned/vocabulary": { loadVocabulary: async () => ({}) },
    "@/lib/search/planned/verify": { verifyInChunks: async (_q: string, _p: SearchPlan, items: PlannedItem[]) => { if (failVerifier) throw new Error("offline"); return { verdicts: new Map(items.map(i => [i.product_id, { v: "good" }])) }; } },
    "./context": { createShoppingContext, readShoppingContext },
    "./policy": { lockRequirements, preserveRequirements, sensitiveRequest },
  });
  return { api, executes: () => executes, fail: () => { failVerifier = true; } };
}
const pool = ["rice", "wheat", "cross-contact", "unknown"].map(id => ({ id }));
test("PDP and swap candidate pools recheck current facts and strict cross-contact", async () => {
  const h = recommendationsHarness();
  const token = createShoppingContext("gluten free biscuits for celiac disease", plan({ strict: true, exclude: ["gluten_source"] }));
  const context = await h.api.resolveShoppingContext(token);
  assert.deepEqual(Array.from(await h.api.filterShoppingCandidates(pool, context), (p: { id: string }) => p.id), ["rice"]);
  h.fail();
  assert.equal((await h.api.filterShoppingCandidates(pool, context)).length, 0, "verifier failure cannot leak alternatives");
});
test("invalid, expired and failed legacy query context suppress alternatives without a DB fallback", async () => {
  const h = recommendationsHarness();
  for (const context of [await h.api.resolveShoppingContext("forged"), await h.api.resolveShoppingContext(createShoppingContext("celiac", plan(), 0)), await h.api.resolveShoppingContext(null, "celiac cookies")]) {
    assert.equal((await h.api.filterShoppingCandidates(pool, context)).length, 0);
  }
  assert.equal(h.executes(), 0);
});
test("combined basket context retains the union of allergies, diets and medical numeric bounds", async () => {
  const h = recommendationsHarness();
  const tokens = [createShoppingContext("celiac cookies", plan({ strict: true, exclude: ["gluten_source"] })), createShoppingContext("vegan low sugar", plan({ diet: { vegan: true }, numeric: [{ field: "sugar_g", op: "<=", value: 5 }] }))];
  const context = await h.api.resolveShoppingContext(JSON.stringify(tokens));
  assert.equal(context.value.plan.strict, true);
  assert.equal(context.value.plan.diet.vegan, true);
  assert.equal(context.value.plan.numeric[0].value, 5);
  assert.ok(context.value.plan.exclude.includes("gluten_source"));
  assert.equal((await h.api.resolveShoppingContext(JSON.stringify([...tokens, "forged"]))).blocked, true);
});
test("basket increments and replacement merges never discard retained contexts", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) };
  const api = load("lib/basket/storage.ts", {}, { window: { dispatchEvent() {} }, localStorage: storage, Event: class {} });
  api.addToBasket("rice", "Rice", "celiac");
  api.addToBasket("rice", "Rice", "vegan");
  api.addToBasket("rice", "Rice");
  assert.deepEqual(Array.from(api.readBasket()[0].shoppingContexts), ["celiac", "vegan"]);
  api.addToBasket("other", "Other", "diabetic");
  api.replaceInBasket("rice", "other", "Other");
  const saved = api.readBasket();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].qty, 4);
  assert.deepEqual(Array.from(saved[0].shoppingContexts).sort(), ["celiac", "diabetic", "vegan"]);
});
test("product and pack-size links carry context exactly, including query punctuation", () => {
  const url = new URL(productHref("rice-cookie", "signed+context", "celiac & vegan"), "https://scout.test");
  assert.equal(url.searchParams.get("context"), "signed+context");
  assert.equal(url.searchParams.get("q"), "celiac & vegan");
});

test("swaps POST applies every retained context and disables shared caching", async () => {
  let filters = 0;
  class ResponseMock {
    constructor(public body: any, public options: any) {}
    static json(body: unknown, options: unknown) { return new ResponseMock(body, options); }
  }
  const route = load("app/api/swaps/route.ts", {
    "next/server": { NextResponse: ResponseMock },
    "@/lib/shopping/recommendations": { resolveShoppingContext: async (token: string) => ({ active: true, token }), filterShoppingCandidates: async (products: any[], context: any) => { filters++; assert.deepEqual(JSON.parse(context.token), ["celiac", "vegan"]); return products.filter(p => p.id === "rice"); } },
    "@/lib/products/alternatives": { findAlternatives: (_current: unknown, products: any[]) => products.map(product => ({ product })) },
    "@/lib/goals/types": { GOAL_PROFILES: [{ id: "balanced" }] },
    "@/lib/diet/types": { dietFromParam: () => "any" },
    "@/lib/products/queries": { getProductsBySlugs: async () => [{ slug: "current", l3_category: "Cookies" }], getProductsForSwaps: async () => [{ id: "rice" }, { id: "wheat" }, { id: "dairy" }] },
  });
  const res = await route.POST({ json: async () => ({ slugs: ["current"], contexts: ["celiac", "vegan"], goal: "balanced" }) });
  assert.equal(filters, 1);
  assert.deepEqual(Array.from(res.body.swaps.current, (s: any) => s.product.id), ["rice"]);
  assert.match(res.options.headers["Cache-Control"], /private, no-store/);
  assert.equal((await route.POST({ json: async () => ({ slugs: ["current"], contexts: [null] }) })).options.status, 400);
});

test("malformed duplicate verifier indices cannot accidentally approve a sensitive product", async () => {
  const { z } = await import("zod");
  const api = load("lib/search/planned/verify.ts", {
    zod: { z },
    "@/lib/search/deepseek-client": { deepseekChat: async () => ({ content: '{"r":[{"i":0,"v":"no"},{"i":0,"v":"good"}]}', usage: null }), extractJsonObject: JSON.parse },
    "./execute": { claimStatus: () => "holds" },
  });
  const result = await api.verifyItems("celiac", plan({ strict: true }), [item("one")]);
  assert.equal(result.verdicts.size, 0);
});


test("saved nuts avoidance excludes peanuts and tree nuts", () => {
  for (const spelling of ["nuts", "nut"]) {
    const p = preserveRequirements(plan(), "cookies", { avoidIngredients: [spelling] });
    assert.ok(p.exclude.includes("peanut"));
    assert.ok(p.exclude.includes("tree_nut"));
  }
});

test("changed URL query cannot add requirements while reusing an earlier signed context", async () => {
  const h = recommendationsHarness();
  const token = createShoppingContext("gluten free cookies", plan({ exclude: ["gluten_source"] }));
  const context = await h.api.resolveShoppingContext(token, "gluten free cookies for peanut allergy");
  assert.equal(context.blocked, true);
  assert.equal(context.token, "unavailable", "do not propagate the older valid context past the mismatch");
  assert.equal((await h.api.filterShoppingCandidates(pool, context)).length, 0);
  assert.equal(h.executes(), 0);
  assert.ok((await h.api.resolveShoppingContext(token, "  GLUTEN free cookies ")).value);
});
