/** Offline cancellation contracts: no database or external provider calls. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import ts from "typescript";
import postgres from "postgres";
import * as runtime from "../lib/search/planned/runtime";
import { degradedPlan } from "../lib/search/planned/search";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function load(path: string, mocks: Record<string, unknown>, env: Record<string, string> = {}): any {
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  runInNewContext(outputText, {
    exports, console: { error() {}, warn() {} }, process: { env }, Date, Buffer, URL, URLSearchParams,
    setTimeout, clearTimeout, AbortController, DOMException,
    require: (id: string) => {
      if (id === "./runtime" || id === "./planned/runtime" || id === "@/lib/search/planned/runtime") return runtime;
      assert.ok(id in mocks, `Unexpected dependency: ${id}`);
      return mocks[id];
    },
  }, { filename: path });
  return exports;
}

test("twelve shelf misses finish within a two-worker bound and duplicate slugs share generation", async () => {
  const queue = new runtime.KeyedWorkQueue<number>(2, 12);
  let active = 0, peak = 0, calls = 0;
  const jobs = Array.from({ length: 12 }, (_, i) => queue.run(String(i), async signal => {
    calls++; active++; peak = Math.max(peak, active);
    try { await runtime.abortableDelay(5, signal); return i; }
    finally { active--; }
  }, { timeoutMs: 1000 }));
  const duplicate = queue.run("0", async () => { throw new Error("duplicate generation"); }, { timeoutMs: 1000 });
  assert.deepEqual(await Promise.all(jobs), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(await duplicate, 0);
  assert.equal(calls, 12);
  assert.equal(peak, 2);
});

test("queued cancellation and queue deadlines remove work before providers or SQL start", async () => {
  const queue = new runtime.KeyedWorkQueue<void>(1, 2);
  const gate = deferred<void>();
  const first = queue.run("busy", () => gate.promise, { timeoutMs: 1000 });
  await nextTurn();
  let starts = 0;
  const controller = new AbortController();
  const cancelled = queue.run("cancelled", async () => { starts++; }, { signal: controller.signal, timeoutMs: 1000 });
  const expired = queue.run("expired", async () => { starts++; }, { timeoutMs: 10 });
  const cancelledCheck = assert.rejects(cancelled, { name: "AbortError" });
  const expiredCheck = assert.rejects(expired, { name: "TimeoutError" });
  controller.abort();
  await Promise.all([cancelledCheck, expiredCheck]);
  gate.resolve();
  await first;
  assert.equal(starts, 0);
});

test("queue overflow is bounded and rejected rather than starting unbounded background work", async () => {
  const queue = new runtime.KeyedWorkQueue<void>(1, 1);
  const gate = deferred<void>();
  const a = queue.run("a", () => gate.promise, { timeoutMs: 1000 });
  const b = queue.run("b", async () => {}, { timeoutMs: 1000 });
  await assert.rejects(queue.run("c", async () => {}, { timeoutMs: 1000 }), /queue is full/);
  gate.resolve();
  await Promise.all([a, b]);
});

test("in-flight SQL receives cancel and worker capacity stays occupied until cancellation settles", async () => {
  const queue = new runtime.KeyedWorkQueue<void>(1, 2);
  const controller = new AbortController();
  const cancelledSql = deferred<void>();
  const cleanup = deferred<void>();
  let cancels = 0, cleaned = false;
  const query = Object.assign(cancelledSql.promise, { cancel() {
    cancels++;
    void cleanup.promise.then(() => { cleaned = true; cancelledSql.reject(new Error("SQL cancelled")); });
  } });
  const first = queue.run("sql", signal => runtime.abortableQuery(query, signal), { signal: controller.signal, timeoutMs: 1000 });
  const check = assert.rejects(first, { name: "AbortError" });
  await nextTurn();
  let nextStarted = false;
  const second = queue.run("next", async () => { assert.equal(cleaned, true); nextStarted = true; }, { timeoutMs: 1000 });
  controller.abort();
  await nextTurn();
  assert.equal(cancels, 1);
  assert.equal(nextStarted, false);
  cleanup.resolve();
  await Promise.all([check, second]);
  assert.equal(nextStarted, true);
});

test("a cancelled shared consumer cannot cancel vocabulary or embedding work still needed by another", async () => {
  const work = new runtime.SharedWork<string>();
  const gate = deferred<string>();
  const a = new AbortController();
  let sharedSignal!: AbortSignal, starts = 0;
  const task = async (signal: AbortSignal) => { sharedSignal = signal; starts++; return gate.promise; };
  const first = work.run("same", task, a.signal);
  const second = work.run("same", task);
  const check = assert.rejects(first, { name: "AbortError" });
  await nextTurn();
  a.abort();
  await check;
  assert.equal(sharedSignal.aborted, false);
  gate.resolve("result");
  assert.equal(await second, "result");
  assert.equal(starts, 1);
});

test("shared task rejection with undefined remains a rejection for every consumer", async () => {
  const work = new runtime.SharedWork<void>();
  const a = work.run("reject", () => Promise.reject(undefined));
  const b = work.run("reject", async () => {});
  const results = await Promise.allSettled([a, b]);
  assert.deepEqual(results, [{ status: "rejected", reason: undefined }, { status: "rejected", reason: undefined }]);
});

test("pre-aborted SQL never executes the lazy query", async () => {
  const controller = new AbortController(); controller.abort();
  let executed = false;
  const query = { then() { executed = true; return Promise.resolve([]); }, cancel() {} };
  await assert.rejects(runtime.abortableQuery(query as any, controller.signal), { name: "AbortError" });
  assert.equal(executed, false);
});

test("provider fetch gets the caller's cancellation, including while response body is pending", async () => {
  const body = deferred<unknown>();
  let fetchSignal!: AbortSignal;
  const api = load("lib/search/deepseek-client.ts", {
    undici: { Agent: class {}, fetch: async (_url: string, opts: any) => {
      fetchSignal = opts.signal;
      fetchSignal.addEventListener("abort", () => body.reject(fetchSignal.reason), { once: true });
      return { ok: true, json: () => body.promise };
    } },
    "@/lib/search/deepseek-keys": { resolveDeepseekApiKey: () => "offline-test" },
  });
  const controller = new AbortController();
  const request = api.deepseekChat({ system: "test", user: "test", signal: controller.signal });
  const check = assert.rejects(request, { name: "AbortError" });
  await nextTurn(); controller.abort(); await check;
  assert.equal(fetchSignal.aborted, true);
});

test("embedding deduplication retains the provider request for a second live search", async () => {
  const response = deferred<unknown>();
  let fetchSignal!: AbortSignal, requests = 0;
  const api = load("lib/search/embeddings.ts", {
    undici: { Agent: class {}, fetch: async (_url: string, opts: any) => {
      requests++; fetchSignal = opts.signal;
      return { ok: true, status: 200, json: () => response.promise };
    } },
  }, { VOYAGE_API_KEY: "offline-test" });
  const controller = new AbortController();
  const first = api.embedText("same", "query", controller.signal);
  const second = api.embedText("same", "query");
  const check = assert.rejects(first, { name: "AbortError" });
  await nextTurn(); controller.abort(); await check;
  assert.equal(fetchSignal.aborted, false);
  response.resolve({ data: [{ index: 0, embedding: [1, 2] }] });
  assert.deepEqual(Array.from(await second), [1, 2]);
  assert.equal(requests, 1);
});

test("vocabulary callers share SQL while one cancelled caller leaves the other intact", async () => {
  const firstRows = deferred<unknown[]>();
  let queries = 0, cancels = 0;
  const sql = () => {
    queries++;
    return Object.assign(queries === 1 ? firstRows.promise : Promise.resolve([]), { cancel() { cancels++; firstRows.reject(new Error("SQL cancelled")); } });
  };
  const api = load("lib/search/planned/vocabulary.ts", {});
  const controller = new AbortController();
  const first = api.loadVocabulary(sql, controller.signal);
  const second = api.loadVocabulary(sql);
  const check = assert.rejects(first, { name: "AbortError" });
  await nextTurn(); controller.abort(); await check;
  assert.equal(cancels, 0);
  firstRows.resolve([{ category: "Biscuits", subcategory: "Cookies", l3: "Cookies", n: 1 }]);
  const vocab = await second;
  assert.equal(vocab.l3.size, 1);
  assert.equal(queries, 2, "one categories query and one brands query serve both consumers");
});

test("last vocabulary consumer abort cancels the categories query and never loads brands", async () => {
  const rows = deferred<unknown[]>();
  let queries = 0, cancels = 0;
  const sql = () => { queries++; return Object.assign(rows.promise, { cancel() { cancels++; rows.reject(new Error("SQL cancelled")); } }); };
  const api = load("lib/search/planned/vocabulary.ts", {});
  const controller = new AbortController();
  const request = api.loadVocabulary(sql, controller.signal);
  const check = assert.rejects(request, { name: "AbortError" });
  await nextTurn(); controller.abort(); await check;
  assert.equal(cancels, 1);
  assert.equal(queries, 1);
});

test("verifier cancellation aborts every active chunk instead of returning an unjudged tail", async () => {
  const { z } = await import("zod");
  let calls = 0, cancelled = 0;
  const api = load("lib/search/planned/verify.ts", {
    zod: { z },
    "./execute": { claimStatus: () => "holds" },
    "@/lib/search/deepseek-client": {
      extractJsonObject: JSON.parse,
      deepseekChat: (opts: any) => new Promise((_yes, no) => {
        calls++;
        opts.signal.addEventListener("abort", () => { cancelled++; no(opts.signal.reason); }, { once: true });
      }),
    },
  });
  const items = Array.from({ length: 26 }, (_, i) => ({ product_id: String(i), claims: [], ingredients: [], present: [], may_contain: [], unknown: [], nutrition: {} }));
  const controller = new AbortController();
  const request = api.verifyInChunks("cookies", degradedPlan("cookies"), items, controller.signal);
  const check = assert.rejects(request, { name: "AbortError" });
  await nextTurn(); controller.abort(); await check;
  assert.equal(calls, 2);
  assert.equal(cancelled, 2);
});

function pipeline(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const plan = degradedPlan("cookies");
  const mocks = {
    "@/lib/search/embeddings": { isEmbeddingConfigured: () => false },
    "./db": { searchSql: () => ({}) },
    "./vocabulary": { loadVocabulary: async () => { calls.push("vocabulary"); return {}; } },
    "./plan-cache": { planCacheKey: () => "key", getCachedPlan: async () => { calls.push("cache"); return null; }, storePlan: async () => { calls.push("store"); } },
    "./plan": { plannerFingerprint: () => "v1", planQuery: async () => { calls.push("planner"); return { plan, dropped: [], usage: null, ms: 0 }; } },
    "./execute": { executePlan: async () => { calls.push("execute"); return { items: [], counts: [], relaxed: [], reference: null, ms: 0 }; } },
    "./verify": { needsVerification: () => false },
    "@/lib/shopping/policy": { preserveRequirements: (p: unknown) => p, lockRequirements: (p: unknown) => p, sensitiveRequest: () => false },
    ...overrides,
  };
  return { api: load("lib/search/planned/search.ts", mocks), calls, plan };
}

test("abort during vocabulary cancels its SQL and never starts cache/planner/execution stages", async () => {
  const pending = deferred<unknown>();
  let cancelled = false;
  const query = Object.assign(pending.promise, { cancel() { cancelled = true; pending.reject(new Error("cancelled SQL")); } });
  const h = pipeline({ "./vocabulary": { loadVocabulary: (_sql: unknown, signal: AbortSignal) => runtime.abortableQuery(query, signal) } });
  const controller = new AbortController();
  const request = h.api.plannedSearch("cookies", { signal: controller.signal });
  const check = assert.rejects(request, { name: "AbortError" });
  await nextTurn(); controller.abort(); await check;
  assert.equal(cancelled, true);
  assert.deepEqual(h.calls, []);
});

test("deadline cancellation stops planner work and cannot fall back to unconstrained results", async () => {
  let providerCancelled = false;
  const h = pipeline({ "./plan": {
    plannerFingerprint: () => "v1",
    planQuery: (_q: string, _v: unknown, _p: unknown, signal: AbortSignal) => new Promise((_yes, no) => {
      signal.addEventListener("abort", () => { providerCancelled = true; no(signal.reason); }, { once: true });
    }),
  } });
  await assert.rejects(h.api.plannedSearch("cookies", { timeoutMs: 10 }), { name: "TimeoutError" });
  assert.equal(providerCancelled, true);
  assert.deepEqual(h.calls, ["vocabulary", "cache"]);
});

test("abort after candidate execution never enters verification or size loading", async () => {
  const controller = new AbortController();
  let verified = false;
  const h = pipeline({
    "./execute": { executePlan: async () => { controller.abort(); return { items: [], counts: [], relaxed: [], reference: null, ms: 0 }; } },
    "./verify": { needsVerification: () => { verified = true; return true; } },
  });
  await assert.rejects(h.api.plannedSearch("cookies", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(verified, false);
});

test("actual PostgreSQL cancellation stops SELECT pg_sleep and the same pool remains usable", { skip: !process.env.SEARCH_CANCEL_TEST_DB_URL }, async () => {
  const sql = postgres(process.env.SEARCH_CANCEL_TEST_DB_URL!, {
    max: 1, connect_timeout: 5, prepare: false,
    ...(process.env.SEARCH_CANCEL_TEST_SSL === "1" ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  try {
    await sql`select 1`;
    const controller = new AbortController();
    const started = performance.now();
    const pending = runtime.abortableQuery(sql`select pg_sleep(5)`, controller.signal);
    const timer = setTimeout(() => controller.abort(), 150);
    try { await assert.rejects(pending, { name: "AbortError" }); }
    finally { clearTimeout(timer); }
    assert.ok(performance.now() - started < 3500, "SQL must settle well before the original five-second sleep finishes");
    const rows = await sql`select 1 as ok`;
    assert.equal(rows[0]?.ok, 1, "cancelled work must not poison or occupy the pool");
  } finally { await sql.end({ timeout: 1 }); }
});
