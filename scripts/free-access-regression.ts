import { searchInputSchema } from "@/lib/search/input";
/** Run with node --import tsx scripts/free-access-regression.ts. External services are mocked. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(path: string, mocks: Record<string, unknown>): any {
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports, console, process, Date,
    require: (id: string) => {
      assert.ok(id in mocks, `Unexpected dependency: ${id}`);
      return mocks[id];
    },
  }, { filename: path });
  return exports;
}

class ResponseMock {
  constructor(public body: any, public status = 200) {}
  static json(body: unknown, options?: { status?: number }) {
    return new ResponseMock(body, options?.status);
  }
}
const next = { NextResponse: ResponseMock };
let identity: { id: string } | null = null;
let searches = 0;
const result = { items: [], rank_source: "test", intent_tier: "structured" };
const auth = { supabaseFromBearer: (header: string | null) => header ? {
  auth: { getUser: async () => ({ data: { user: identity } }) },
} : null };
const route = load("app/api/search/route.ts", {
  "next/server": next,
  "@/lib/search/input": { searchInputSchema },
  "@/lib/auth/supabase-user": auth,
  "@/lib/supabase/admin": { adminClient: () => ({ from: () => ({ insert: () => Promise.resolve({}) }) }) },
  "@/lib/search/result-cache": { resultCacheKey: () => "k", getCachedResult: () => null, setCachedResult: () => {} },
  "@/lib/search/planned/search": { plannedSearch: async () => { searches++; return { timings: {}, llm: {}, items: [], unconfirmed: [], relaxed: [], plan: { intent: "product" } }; } },
  "@/lib/search/planned/present": { presentSearch: () => result },
});
const request = (token: string | null, prompt = "yogurt") => ({
  headers: new Headers(token ? { authorization: `Bearer ${token}`, "x-forwarded-for": "127.0.0.1" } : { "x-forwarded-for": "127.0.0.1" }),
  json: async () => ({ q: prompt }),
  // Previously exhausted anonymous cookies must no longer be consulted.
  cookies: { get: () => { throw new Error("Search read the retired quota cookie"); } },
});
for (const token of [null, "signed-in", "expired-session"]) {
  identity = token === "signed-in" ? { id: "user-1" } : null;
  for (let i = 0; i < 101; i++) {
    const response = await route.POST(request(token, `yogurt ${i}`));
    assert.equal(response.status, 200);
  }
}
assert.equal(searches, 303, "Every uncached request should reach search");
assert.equal((await route.POST(request(null, "x"))).status, 400);

const guard = load("lib/auth/require-user.ts", {
  "next/server": next,
  "@/lib/auth/supabase-user": auth,
  "@/lib/supabase/admin": { adminClient: () => ({}) },
  "@/lib/auth/profile": { getProfileForUser: async () => ({ id: "user-1", email: "test@example.com" }) },
});
assert.equal((await guard.requireAuthedUser(request(null))).status, 401);
identity = { id: "user-1" };
assert.equal((await guard.requireAuthedUser(request("signed-in"))).user.id, "user-1");
const alerts = load("app/api/me/search-alerts/route.ts", {
  "next/server": next,
  "@/lib/auth/require-user": guard,
  "@/lib/supabase/admin": { adminClient: () => ({ from: () => ({ select: () => ({
    eq: (key: string, value: string) => {
      assert.equal(key, "user_id"); assert.equal(value, "user-1");
      return { eq: async () => ({ data: [] }) };
    },
  }) }) }) },
  "@/lib/search/alerts/runner": { runAlertsForRecords: async () => [] },
});
assert.equal((await alerts.POST(request(null))).status, 401);
assert.equal((await alerts.POST(request("signed-in"))).status, 200, "Alerts need an account, not a plan");
console.log("PASS: 303 guest/authenticated/expired-session searches without quotas, and account-only alerts.");
