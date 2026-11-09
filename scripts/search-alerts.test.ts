/** Saved-search alert state: offline, with a stubbed database and search. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "@/lib/search/planned/db";
import { newMatches, runAlerts, type AlertTrigger, type DueAlert } from "@/lib/search/alerts/runner";

const alert: DueAlert = { saved_search_id: "s1", user_id: "u1", query: "high protein bars", preferences: {} };

function stubSql(state: { id: string; seen_product_ids: string[] | null; last_match_count: number }, failOn?: RegExp) {
  const calls: { text: string; values: unknown[] }[] = [];
  let committed = 0;
  const tag = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    if (failOn?.test(text)) return Promise.reject(new Error("write failed"));
    return Promise.resolve(/^insert into public\.search_alerts/.test(text) ? [state] : []);
  }, { json: (value: unknown) => value });
  const sql = Object.assign(tag, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => { const out = await fn(tag); committed++; return out; },
  }) as unknown as Sql;
  return { sql, calls, commits: () => committed };
}

function searchReturning(ids: string[]) {
  return (async () => ({ items: ids.map(product_id => ({ product_id })) })) as never;
}

test("the first run records a baseline and reports nothing", () => {
  assert.deepEqual(newMatches(["a", "b", "a"], null), { fresh: [], seen: ["a", "b"] });
});

test("later runs report only products never reported before", () => {
  const { fresh, seen } = newMatches(["a", "c", "b"], ["b", "a"]);
  assert.deepEqual(fresh, ["c"]);
  assert.deepEqual(seen, ["c", "b", "a"]);
  // A product that drops out and comes back is not new.
  assert.deepEqual(newMatches(["a"], ["c", "b", "a"]).fresh, []);
});

test("a full page of matches can still report a new product", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
  assert.deepEqual(newMatches([...twelve.slice(1), "p12"], twelve).fresh, ["p12"]);
});

test("the seen list is capped, newest first", () => {
  const old = Array.from({ length: 1000 }, (_, i) => `o${i}`);
  const { seen } = newMatches(["n1", "o0"], old);
  assert.equal(seen.length, 1000);
  assert.equal(seen[0], "n1");
});

test("a new product writes the notification and the state in one transaction, then emails", async () => {
  const db = stubSql({ id: "a1", seen_product_ids: ["p1"], last_match_count: 1 });
  const emailed: AlertTrigger[][] = [];
  const triggered = await runAlerts([alert], { sql: db.sql, search: searchReturning(["p1", "p2"]), email: async t => { emailed.push(t); } });
  assert.deepEqual(triggered, [{ id: "a1", user_id: "u1", query: "high protein bars", new_matches: 1, previous: 1 }]);
  assert.equal(db.commits(), 1);
  const texts = db.calls.map(c => c.text);
  assert.match(texts[0]!, /^insert into public\.search_alerts .* on conflict \(saved_search_id\) do update/);
  assert.ok(texts.some(t => /^insert into public\.alert_notifications/.test(t)));
  const update = db.calls.find(c => /^update public\.search_alerts/.test(c.text))!;
  assert.deepEqual(update.values[0], ["p2", "p1"]);
  assert.ok(texts.includes("now()"), "last_notified_at moves when something is reported");
  assert.deepEqual(emailed, [triggered]);
});

test("a run with nothing new writes no notification", async () => {
  const db = stubSql({ id: "a1", seen_product_ids: ["p1", "p2"], last_match_count: 2 });
  const triggered = await runAlerts([alert], { sql: db.sql, search: searchReturning(["p2"]), email: async () => assert.fail("no email") });
  assert.deepEqual(triggered, []);
  assert.ok(!db.calls.some(c => /alert_notifications/.test(c.text)));
  assert.ok(db.calls.some(c => c.text === "last_notified_at"));
});

test("a failed state write reports nothing, so the next run reports the same products", async () => {
  const db = stubSql({ id: "a1", seen_product_ids: ["p1"], last_match_count: 1 }, /^update public\.search_alerts/);
  const triggered = await runAlerts([alert], { sql: db.sql, search: searchReturning(["p1", "p2"]), email: async () => assert.fail("no email") });
  assert.deepEqual(triggered, []);
  assert.equal(db.commits(), 0);
});

test("one failing alert does not stop the others", async () => {
  const db = stubSql({ id: "a1", seen_product_ids: [], last_match_count: 0 });
  let calls = 0;
  const search = (async () => { if (calls++ === 0) throw new Error("timeout"); return { items: [{ product_id: "p9" }] }; }) as never;
  const triggered = await runAlerts([alert, { ...alert, saved_search_id: "s2" }], { sql: db.sql, search, email: async () => {} });
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0]!.new_matches, 1);
});
