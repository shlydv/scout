/** proxy.ts: only slugs shaped like old ones reach the redirect lookup, and redirects keep the query. */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { NextRequest } from "next/server";

// Set before proxy.ts (and the Supabase client it imports) is loaded below.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.PRODUCT_SLUG_REDIRECT_PREFIXES = "legacy-";

const lookups: string[][] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const { p_slugs } = JSON.parse(String(init?.body ?? "{}")) as { p_slugs: string[] };
  lookups.push(p_slugs);
  const rows = p_slugs
    .filter((s) => s.startsWith("legacy-") && !s.includes("unknown"))
    .map((s) => ({ old_slug: s, slug: s.slice("legacy-".length) }));
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const run = async (path: string) => (await import("../proxy")).proxy(new NextRequest(`http://localhost${path}`));

beforeEach(() => {
  lookups.length = 0;
});

test("a current slug never calls the lookup", async () => {
  const res = await run("/product/amul-amul-butter-1a2b3c4d?context=c1");
  assert.equal(res.headers.get("x-middleware-next"), "1");
  assert.deepEqual(lookups, []);
});

test("an old slug 308s to the current slug with ?context= and ?q= kept", async () => {
  const res = await run("/product/legacy-amul-amul-butter-1a2b3c4d?context=c1&q=peanut%20free");
  assert.equal(res.status, 308);
  const to = new URL(res.headers.get("location") ?? "");
  assert.equal(to.pathname, "/product/amul-amul-butter-1a2b3c4d");
  assert.equal(to.searchParams.get("context"), "c1");
  assert.equal(to.searchParams.get("q"), "peanut free");
  assert.deepEqual(lookups, [["legacy-amul-amul-butter-1a2b3c4d"]]);
});

test("an old-shaped slug with no redirect on file renders as usual", async () => {
  const res = await run("/product/legacy-unknown-1a2b3c4d");
  assert.equal(res.headers.get("x-middleware-next"), "1");
  assert.deepEqual(lookups, [["legacy-unknown-1a2b3c4d"]]);
});
