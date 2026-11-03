import { createHmac, timingSafeEqual } from "node:crypto";
import type { SearchPlan } from "@/lib/search/planned/plan";
import { preserveRequirements, sensitiveRequest } from "./policy";

export type ShoppingContext = { version: 1; query: string; plan: SearchPlan; expires: number };
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
let derived: { from: string; key: string } | null = null;
function secret(): string {
  if (process.env.SHOPPING_CONTEXT_SECRET) return process.env.SHOPPING_CONTEXT_SECRET;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DB_URL;
  if (!base) throw new Error("Shopping context signing is unavailable");
  // Without a dedicated secret, sign with a key derived for this purpose only,
  // never with the database credential itself.
  if (derived?.from !== base) derived = { from: base, key: createHmac("sha256", base).update("scout-shopping-context-key-v1").digest("base64url") };
  return derived.key;
}
function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`scout-shopping-v1:${payload}`).digest("base64url");
}
export function createShoppingContext(query: string, plan: SearchPlan, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, query, plan, expires: now + TTL_MS } satisfies ShoppingContext)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function readShoppingContext(token: string, now = Date.now()): ShoppingContext | null {
  try {
    if (token.length > 20000) return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return null;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as ShoppingContext;
    if (value.version !== 1 || !Number.isFinite(value.expires) || value.expires <= now || typeof value.query !== "string" || !value.plan) return null;
    // Only plans signed by this server are accepted, never client-supplied filters.
    return { ...value, plan: preserveRequirements(value.plan, value.query) };
  } catch { return null; }
}
export { sensitiveRequest };
