import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDecisionResponse, cloudflareDecide, DecisionUnavailableError, type DecisionRequest } from "@/lib/search/decision/cloudflare";
import { evaluateCandidates, evaluationRequest, orderMatches, rankDecisions } from "@/lib/search/decision/evaluate";
import { mapDbRow } from "@/lib/search/decision/index-row";
import { productEvidence, type EvidenceCandidate } from "@/lib/search/decision/retrieval";
import { searchInputSchema } from "@/lib/search/decision/input";
import { singleFlight } from "@/lib/search/decision/single-flight";
import type { Product } from "@/lib/supabase/types";

function candidate(id: string, price: number | null = 50): EvidenceCandidate {
  return { row: mapDbRow({ product_id: id, slug: id, name: id, price_inr: price }), evidence: {
    id, name: id, brand: null, category: "biscuits", subcategory: null, ingredients: "Rice flour, sugar", nutrition_per_100g: { sugar_g_100g: 4, source: "label" },
    attributes: { "Allergen Information": "May contain wheat" }, price_inr: price, pack: "100g", source: { url: null, updated_at: "2026-10-07", data_source: "platform" },
  } };
}
function response(request: DecisionRequest, choices: string[] = []) {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => {
    if (q.type === "score") return [id, { type: "score", score: 3 }];
    const choice = id === "sort" ? "cheapest" : choices[Number(id.slice(1).split("_")[0])] ?? "match";
    return [id, { type: "choice", choice, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === choice ? 1 : 0])) }];
  }));
  return validateDecisionResponse({ answers, usage: { input_tokens: 100 } }, request);
}

test("malformed, missing and contradictory provider decisions fail closed", () => {
  const request = evaluationRequest("gluten free biscuits", null, [candidate("a")]);
  assert.throws(() => validateDecisionResponse({ answers: {} }, request));
  const good = response(request);
  assert.throws(() => validateDecisionResponse({ answers: { ...good.answers, p0_match: { type: "choice", choice: "match", probabilities: { match: 0.2, reject: 0.8, unknown: 0 } } } }, request));
  assert.throws(() => validateDecisionResponse({ answers: { ...good.answers, p0_relevance: { type: "score", score: 99 } } }, request));
});
test("unknown and rejected matches are never relaxed or returned", () => {
  const candidates = [candidate("a"), candidate("b"), candidate("c")];
  const request = evaluationRequest("gluten free biscuits", null, candidates);
  assert.deepEqual(rankDecisions(candidates, response(request, ["unknown", "reject", "match"])).map(x => x.row.product_id), ["c"]);
});
test("numeric sorting preserves zero and puts missing values last", () => {
  const candidates = [candidate("a", 50), candidate("b", null), candidate("c", 0)];
  const items = rankDecisions(candidates, response(evaluationRequest("cheap biscuits", null, candidates)));
  assert.deepEqual(orderMatches(items, "cheapest").map(x => x.row.product_id), ["c", "a", "b"]);
});
test("evidence retains complete ingredients, allergen attributes, units and source", () => {
  const ingredients = "Rice flour, ".repeat(200) + "may contain wheat";
  const p = { id: "a", name: "Biscuits", ingredients_raw: ingredients, nutrition: { sugar_g_100g: 0, source: "label" }, attributes: { Allergens: "wheat" }, updated_at: "today", price_inr: 0 } as unknown as Product;
  const evidence = productEvidence(p);
  assert.equal(evidence.ingredients, ingredients);
  assert.equal(evidence.attributes?.Allergens, "wheat");
  assert.equal(evidence.nutrition_per_100g?.sugar_g_100g, 0);
  assert.equal(evidence.nutrition_per_100g?.source, "label");
  assert.equal(evidence.price_inr, 0);
});
test("parallel decisions isolate evidence and keep the question schema consistent", async () => {
  const candidates = Array.from({ length: 30 }, (_, i) => candidate(String(i)));
  const requests: DecisionRequest[] = [];
  const result = await evaluateCandidates("cheap biscuits", { avoidIngredients: ["milk"] }, candidates, async r => { requests.push(r); return response(r); });
  assert.equal(result.items.length, 30);
  assert.equal(requests.length, 30);
  assert.ok(requests.every(r => Object.keys((r.state as { products: object }).products).length === 1));
  assert.ok(requests.every(r => r.questions.sort));
  assert.ok(requests.every(r => Object.keys(r.questions).length <= 64));
  assert.equal(result.inputTokens, requests.length * 100);
  assert.ok(requests.every(r => JSON.stringify(r.state).includes('"milk"')));
});
test("request validation bounds user-controlled model input", () => {
  assert.equal(searchInputSchema.safeParse({ prompt: "x".repeat(1001) }).success, false);
  assert.equal(searchInputSchema.safeParse({ prompt: "biscuits", limit: NaN }).success, false);
  assert.equal(searchInputSchema.safeParse({ prompt: "biscuits", preferences: { budget: -1 } }).success, false);
});
test("single-flight shares concurrent work, isolates keys and permits retry", async () => {
  const run = singleFlight<number>(); let calls = 0;
  const work = async () => { calls++; return 1; };
  await Promise.all([run("a", work), run("a", work), run("b", work)]);
  assert.equal(calls, 2);
  await assert.rejects(run("fail", async () => { throw new Error("failure"); }));
  assert.equal(await run("fail", work), 1);
});
test("Cloudflare uses REST envelope; quota exhaustion never produces results", async () => {
  const oldFetch = globalThis.fetch, account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_AUTH_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account"; process.env.CLOUDFLARE_AUTH_TOKEN = "test-token";
  try {
    const request = evaluationRequest("biscuits", null, [candidate("a")]);
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).endsWith("/ai/run/@cf/cloudflare/clef"));
      assert.equal(JSON.parse(String(init?.body)).model, "clef");
      return new Response(JSON.stringify({ success: true, result: response(request) }));
    };
    assert.ok((await cloudflareDecide(request)).answers.p0_match);
    globalThis.fetch = async () => new Response("quota exhausted", { status: 429 });
    await assert.rejects(cloudflareDecide(request), DecisionUnavailableError);
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, result: { answers: {} } }));
    await assert.rejects(cloudflareDecide(request), DecisionUnavailableError);
  } finally {
    globalThis.fetch = oldFetch;
    if (account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = account;
    if (token === undefined) delete process.env.CLOUDFLARE_AUTH_TOKEN; else process.env.CLOUDFLARE_AUTH_TOKEN = token;
  }
});

test("oversized evidence fails before spending any model quota", async () => {
  const c = candidate("large"); c.evidence.ingredients = "x".repeat(50_000);
  let calls = 0;
  await assert.rejects(evaluateCandidates("biscuits", null, [candidate("small"), c], async r => { calls++; return response(r); }), DecisionUnavailableError);
  assert.equal(calls, 0);
});
test("one failed batch prevents a misleading partial successful search", async () => {
  const candidates = Array.from({ length: 30 }, (_, i) => candidate(String(i)));
  let calls = 0;
  await assert.rejects(evaluateCandidates("biscuits", null, candidates, async r => {
    if (++calls === 2) throw new DecisionUnavailableError();
    return response(r);
  }), DecisionUnavailableError);
});
test("low-confidence match is excluded even when it is the winning option", () => {
  const candidates = [candidate("a")], request = evaluationRequest("biscuits", null, candidates);
  const result = response(request);
  result.answers.p0_match = { type: "choice", choice: "match", probabilities: { match: 0.6, reject: 0.2, unknown: 0.2 } };
  assert.equal(rankDecisions(candidates, validateDecisionResponse(result, request)).length, 0);
});
