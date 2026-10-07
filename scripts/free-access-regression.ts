import { searchInputSchema } from "@/lib/search/decision/input";
import { DecisionUnavailableError } from "@/lib/search/decision/cloudflare";
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
const route = load("app/api/search/ai/route.ts", {
  "next/server": next,
  "@/lib/search/decision/input": { searchInputSchema },
  "@/lib/search/decision/cloudflare": { DecisionUnavailableError },
  "@/lib/auth/supabase-user": auth,
  "@/lib/supabase/admin": { adminClient: () => ({ from: () => ({ insert: () => Promise.resolve({}) }) }) },
  "@/lib/search/search-cache": { getCachedAiResult: () => null, setCachedAiResult: () => {} },
  "@/lib/search/v2/pipeline": { runSearchV2: async () => { searches++; return {}; } },
  "@/lib/search/v2/adapter": { searchV2ToAiResult: async () => result },
});
const request = (token: string | null, prompt = "yogurt") => ({
  headers: new Headers(token ? { authorization: `Bearer ${token}`, "x-forwarded-for": "127.0.0.1" } : { "x-forwarded-for": "127.0.0.1" }),
  json: async () => ({ prompt }),
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
  "@/lib/search/v2/alert-runner": { runAlertsForRecords: async () => [] },
});
assert.equal((await alerts.POST(request(null))).status, 401);
assert.equal((await alerts.POST(request("signed-in"))).status, 200, "Alerts need an account, not a plan");
let mobileSearches = 0;
const mobile = load("oasis-mobile/src/lib/run-search.ts", {
  "@/lib/api": { fetchAiSearch: async () => { mobileSearches++; return result; } },
  "@/lib/ai-usage": { readAiSearchPreferences: async () => ({}) },
});
for (let i = 0; i < 1001; i++) await mobile.runCatalogSearch("yogurt", null, null);
assert.equal(mobileSearches, 1001, "Mobile must not retain its former 999-search cap");
console.log("PASS: 303 guest/authenticated/expired-session searches, account-only alerts, and 1001 mobile searches without quotas.");
