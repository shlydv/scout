/** App code never turns off TLS certificate checks; trust extra roots with NODE_USE_SYSTEM_CA=1 instead. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOTS = ["app", "lib", "components", "proxy.ts"];
const BYPASS = /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/;

function files(path: string): string[] {
  try {
    if (!statSync(path).isDirectory()) return /\.(ts|tsx|js|mjs)$/.test(path) ? [path] : [];
  } catch {
    return [];
  }
  return readdirSync(path).flatMap((name) => (name === "node_modules" ? [] : files(join(path, name))));
}

test("no app code skips TLS certificate verification", () => {
  const offenders = ROOTS.flatMap(files).filter((f) => BYPASS.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
