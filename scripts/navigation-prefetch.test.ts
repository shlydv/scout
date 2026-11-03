import assert from "node:assert/strict";
import test from "node:test";
import { routeNeedsOnDemandData } from "../lib/navigation/prefetch";

test("catalogue navigation does not speculate live queries, including query and object URLs", () => {
  for (const href of ["/", "/?from=logo", "/search?q=celiac", "/shelves", "/shelves/kids-tiffin", "/insights/claims", "/brands/amul", "/catalog?verdict=skip", "/product/food?context=signed", { pathname: "/search" }]) {
    assert.equal(routeNeedsOnDemandData(href), true);
  }
});
test("static and external navigation keeps its normal prefetch policy", () => {
  for (const href of ["/privacy", "/terms", "/login", "/shelves-guide", "https://example.com/catalog", "//example.com/search", "#top", { pathname: "/privacy" }]) {
    assert.equal(routeNeedsOnDemandData(href), false);
  }
});

import { singleFlight } from "../lib/cache/single-flight";
test("simultaneous catalogue misses share work; completion and failures allow a fresh load", async () => {
  let calls = 0;
  let resolve!: (value: number) => void;
  const load = singleFlight(() => { calls++; return new Promise<number>(r => { resolve = r; }); });
  const a = load(), b = load();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(42);
  assert.deepEqual(await Promise.all([a, b]), [42, 42]);
  const c = load(); await Promise.resolve(); assert.equal(calls, 2); resolve(43); assert.equal(await c, 43);
  let attempts = 0;
  const retry = singleFlight(async () => { if (++attempts === 1) throw Error("unavailable"); return 7; });
  await assert.rejects(retry(), /unavailable/);
  assert.equal(await retry(), 7);
});
