/** Cache contracts are offline; optional integration runs only in READ ONLY. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import type { Sql } from "@/lib/search/planned/db";
import { getCachedPlan, planCacheKey, storePlan } from "@/lib/search/planned/plan-cache";
import { createSharedPlanWriter, type SharedPlanRecord } from "@/lib/search/planned/plan-cache-writer";
import type { SearchPlan } from "@/lib/search/planned/plan";

const HOUR = 60 * 60_000;
function plan(): SearchPlan {
  return {
    intent: "product", l3: ["Cookies > Butter Biscuits"], subcategories: [], categories: [], brands: [], name_terms: [],
    require: [], exclude: ["peanut"], strict: true, claims_required: [], claims_preferred: [], diet: { vegan: true },
    numeric: [{ field: "price_inr", op: "<=", value: 100 }], sort: { field: "price_inr", dir: "asc" },
    semantic_query: "peanut free vegan cookies", judge: [], relax: ["scope"], comparison: null, summary: "Cookies under ₹100",
  };
}
function stubSql(run: (text: string, values: unknown[]) => unknown = () => []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return Object.assign(Promise.resolve().then(() => run(text, values)), { cancel: async () => {} });
  }, { json: (value: unknown) => value }) as unknown as Sql;
  return { sql, calls };
}
function row(now = Date.now(), overrides: Record<string, unknown> = {}) {
  return { plan: plan(), dropped: [], created_at: new Date(now), ...overrides };
}

test("shared lookup uses SELECT and preserves hard requirements on a local hit", async () => {
  const key = randomUUID();
  const source = row();
  const { sql, calls } = stubSql(() => [source]);
  const first = await getCachedPlan(sql, key);
  assert.deepEqual(first, { plan: source.plan, dropped: [] });
  assert.match(calls[0]!.text, /^\s*select plan, dropped, created_at from public\.search_plan_cache/i);
  assert.doesNotMatch(calls[0]!.text, /\b(update|insert|delete)\b/i);
  assert.match(calls[0]!.text, /created_at > now\(\) - make_interval/);
  assert.deepEqual(calls[0]!.values, [key, 3]);
  first!.plan.exclude.length = 0;
  first!.plan.diet.vegan = false;
  assert.deepEqual(await getCachedPlan(sql, key), { plan: source.plan, dropped: [] });
  assert.equal(calls.length, 1);
});

test("local hits expire at six hours without extending the shared row's three-day lifetime", async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const { sql, calls } = stubSql(() => [row(now)]);
  const key = randomUUID();
  assert.ok(await getCachedPlan(sql, key));
  now += 6 * HOUR - 1;
  assert.ok(await getCachedPlan(sql, key));
  assert.equal(calls.length, 1);
  now++;
  assert.ok(await getCachedPlan(sql, key));
  assert.equal(calls.length, 2);

  const sharedCreated = now - 72 * HOUR + 1000;
  const nearlyExpired = stubSql(() => [row(sharedCreated)]);
  const almostOldKey = randomUUID();
  assert.ok(await getCachedPlan(nearlyExpired.sql, almostOldKey));
  now += 1000;
  assert.equal(await getCachedPlan(nearlyExpired.sql, almostOldKey), null);
  assert.equal(nearlyExpired.calls.length, 2);
});

test("malformed, degraded, expired and absent shared plans are misses, never weakened plans", async () => {
  const malformed: Record<string, unknown>[] = [
    { plan: { ...plan(), exclude: undefined } },
    { plan: { ...plan(), exclude: ["unknown_allergen"] } },
    { plan: { ...plan(), strict: "true" } },
    { plan: { ...plan(), diet: { vegan: "true" } } },
    { plan: { ...plan(), diet: { unknownDiet: true } } },
    { plan: { ...plan(), numeric: [{ field: "price_inr", op: "<=", value: "100" }] } },
    { plan: { ...plan(), numeric: [{ field: "invented", op: "<=", value: 100 }] } },
    { plan: { ...plan(), claims_required: ["invented"] } },
    { dropped: null }, { dropped: ["planner:degraded"] },
    { created_at: new Date(Date.now() - 72 * HOUR) }, { created_at: "invalid-date" },
  ];
  for (const overrides of malformed) {
    const { sql, calls } = stubSql(() => [row(Date.now(), overrides)]);
    const key = randomUUID();
    assert.equal(await getCachedPlan(sql, key), null);
    assert.equal(await getCachedPlan(sql, key), null);
    assert.equal(calls.length, 2, "invalid data must not enter local cache");
  }
  assert.equal(await getCachedPlan(stubSql().sql, randomUUID()), null);
  assert.equal(await getCachedPlan(stubSql(() => { throw new Error("database unavailable"); }).sql, randomUUID()), null);
});

test("failed REST persistence leaves an isolated local plan usable; no PG write or degraded plan is sent", async () => {
  const { sql, calls } = stubSql(() => { throw new Error("PG writes are forbidden"); });
  const written: SharedPlanRecord[] = [];
  const writer = async (record: SharedPlanRecord) => { written.push(record); throw new Error("REST unavailable"); };
  const key = randomUUID();
  const source = plan();
  const pending = storePlan(sql, key, source, [], undefined, writer);
  source.exclude.length = 0;
  await pending;
  const hit = await getCachedPlan(sql, key);
  assert.deepEqual(hit?.plan.exclude, ["peanut"]);
  assert.equal(written.length, 1);
  assert.deepEqual(written[0]?.plan.exclude, ["peanut"]);
  assert.equal(calls.length, 0);
  const degradedKey = randomUUID();
  await storePlan(sql, degradedKey, plan(), ["planner:degraded"], undefined, writer);
  assert.equal(await getCachedPlan(stubSql().sql, degradedKey), null);
  await storePlan(sql, randomUUID(), { ...plan(), strict: "bad" } as unknown as SearchPlan, [], undefined, writer);
  assert.equal(written.length, 1);
  assert.equal(calls.length, 0);
});

test("keys retain preferences and planner/vocabulary fingerprint isolation", () => {
  const base = planCacheKey("  Vegan  cookies ", null, "fingerprint-1");
  assert.equal(base, planCacheKey("vegan cookies", null, "fingerprint-1"));
  assert.notEqual(base, planCacheKey("vegan cookies", { avoidIngredients: ["peanut"] }, "fingerprint-1"));
  assert.notEqual(base, planCacheKey("vegan cookies", null, "fingerprint-2"));
});

test("a pre-aborted request cannot read, reuse or store a plan", async () => {
  const { sql, calls } = stubSql(() => [row()]);
  const controller = new AbortController();
  const reason = new Error("request cancelled");
  controller.abort(reason);
  await assert.rejects(getCachedPlan(sql, randomUUID(), controller.signal), error => error === reason);
  assert.throws(() => storePlan(sql, randomUUID(), plan(), [], controller.signal), error => error === reason);
  const localKey = randomUUID();
  await storePlan(sql, localKey, plan(), [], undefined, async () => {});
  await assert.rejects(getCachedPlan(sql, localKey, controller.signal), error => error === reason);
  assert.equal(calls.length, 0, "no aborted lookup or store may start SQL");
});

test("an aborted shared lookup propagates cancellation instead of returning a miss", async () => {
  const controller = new AbortController();
  const reason = new Error("request cancelled during cache lookup");
  const { sql } = stubSql(() => { controller.abort(reason); throw reason; });
  await assert.rejects(getCachedPlan(sql, randomUUID(), controller.signal), error => error === reason);
});

test("shared writer uses only the cache REST table and waits for persistence settlement", async () => {
  let complete!: (response: Response) => void;
  let request: { url: string; init: RequestInit } | undefined;
  const warnings: string[] = [];
  const writer = createSharedPlanWriter({
    config: () => ({ url: "https://cache-test.supabase.co/rest/v1/", key: "server-only-test-key" }),
    fetch: ((url, init) => { request = { url: String(url), init: init! }; return new Promise<Response>(resolve => { complete = resolve; }); }) as typeof fetch,
    warn: warning => warnings.push(warning),
  });
  let settled = false;
  const record = { cache_key: "new-key", plan: plan(), dropped: [] };
  const pending = writer(record).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(request?.url, "https://cache-test.supabase.co/rest/v1/search_plan_cache?on_conflict=cache_key");
  assert.equal(request?.init.method, "POST");
  assert.equal(request?.init.redirect, "error");
  assert.equal(request?.init.cache, "no-store");
  assert.deepEqual(request?.init.headers, {
    apikey: "server-only-test-key", authorization: "Bearer server-only-test-key",
    "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal",
  });
  const payload = JSON.parse(request!.init.body as string);
  assert.deepEqual(payload, { ...record, created_at: payload.created_at, hits: 0 });
  assert.ok(Number.isFinite(Date.parse(payload.created_at)));
  complete(new Response(null, { status: 201 }));
  await pending;
  assert.equal(settled, true);
  assert.deepEqual(warnings, []);
});

test("unconfigured, failed or timed-out persistence is explicit, bounded and never logs secrets", async () => {
  const warnings: string[] = [];
  const record = { cache_key: "new-key", plan: plan(), dropped: [] };
  let calls = 0;
  const absent = createSharedPlanWriter({ config: () => null, fetch: (() => { calls++; throw new Error("unexpected fetch"); }) as typeof fetch, warn: m => warnings.push(m) });
  await absent(record); await absent(record);
  assert.equal(calls, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /configuration missing.*process-local/);
  const failed = createSharedPlanWriter({
    config: () => ({ url: "https://cache-test.supabase.co", key: "secret-must-not-be-logged" }),
    fetch: (async () => { calls++; throw new Error("secret-must-not-be-logged"); }) as typeof fetch,
    warn: m => warnings.push(m),
  });
  await failed(record); await failed(record);
  assert.equal(calls, 2, "no special retry loop");
  assert.equal(warnings.length, 2, "failure diagnostic emitted once per transport");
  assert.doesNotMatch(warnings.join(" "), /secret-must-not-be-logged|cache-test/);
  const timeout = createSharedPlanWriter({
    config: () => ({ url: "https://cache-test.supabase.co", key: "server-only-test-key" }),
    fetch: ((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }))) as typeof fetch,
    warn: m => warnings.push(m), timeoutMs: 5,
  });
  await timeout(record);
  assert.match(warnings.at(-1)!, /write deadline exceeded/);
});

test("request cancellation aborts REST persistence and is drained without a failure diagnostic", async () => {
  const controller = new AbortController();
  const warnings: string[] = [];
  let cancelled = false;
  const writer = createSharedPlanWriter({
    config: () => ({ url: "https://cache-test.supabase.co", key: "server-only-test-key" }),
    fetch: ((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => { cancelled = true; reject(init!.signal!.reason); }, { once: true }))) as typeof fetch,
    warn: m => warnings.push(m),
  });
  const pending = writer({ cache_key: "new-key", plan: plan(), dropped: [] }, controller.signal);
  controller.abort(new Error("request left"));
  await pending;
  assert.equal(cancelled, true);
  assert.deepEqual(warnings, []);
});

const integrationUrl = process.env.PLAN_CACHE_TEST_DB_URL;
test("actual shared lookup succeeds inside a READ ONLY transaction without updating hit counters", { skip: !integrationUrl }, async () => {
  const sql = postgres(integrationUrl!, { max: 1, connect_timeout: 10, prepare: false, ssl: { rejectUnauthorized: false } });
  try {
    await sql.begin("read only", async tx => {
      const mode = await tx<{ transaction_read_only: string }[]>`show transaction_read_only`;
      assert.equal(mode[0]?.transaction_read_only, "on");
      assert.equal(await getCachedPlan(tx as unknown as Sql, `missing-${randomUUID()}`), null);
      const rows = await tx<{ cache_key: string; hits: number; last_hit_at: Date | null }[]>`
        select cache_key, hits, last_hit_at from public.search_plan_cache
        where created_at > now() - interval '3 days' order by created_at desc limit 20`;
      assert.ok(rows.length, "integration requires an existing unexpired shared plan; do not insert a fixture");
      let checked = false;
      for (const before of rows) {
        const hit = await getCachedPlan(tx as unknown as Sql, before.cache_key);
        if (!hit) continue;
        const [after] = await tx<{ hits: number; last_hit_at: Date | null }[]>`
          select hits, last_hit_at from public.search_plan_cache where cache_key = ${before.cache_key}`;
        assert.deepEqual(after, { hits: before.hits, last_hit_at: before.last_hit_at });
        checked = true;
        break;
      }
      assert.ok(checked, "integration requires an existing valid plan; invalid entries are safe misses");
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
});
