/**
 * Two-level plan cache: in-process map (instant) backed by search_plan_cache
 * (shared across serverless instances). Keys include a hash of the planner
 * prompt, so prompt or vocabulary changes invalidate old plans automatically.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { CLAIM_IDS, CONCEPT_IDS, NUMERIC_FIELD_IDS } from "@/lib/facts/vocab";
import type { Sql } from "./db";
import type { Preferences, SearchPlan } from "./plan";
import { abortableQuery, throwIfAborted } from "./runtime";
import { writeSharedPlan } from "./plan-cache-writer";

type CachedPlan = { plan: SearchPlan; dropped: string[] };
const LOCAL = new Map<string, { expiresAt: number; value: CachedPlan }>();
const LOCAL_TTL_MS = 6 * 60 * 60_000;
const SHARED_TTL_DAYS = 3;
const SHARED_TTL_MS = SHARED_TTL_DAYS * 24 * 60 * 60_000;

// Shared JSON must already be a complete validated plan. Unlike raw model
// parsing, a cache read must never default away a malformed hard requirement.
const numericField = z.enum(NUMERIC_FIELD_IDS);
const cachedPlanSchema: z.ZodType<SearchPlan> = z.object({
  intent: z.enum(["product", "goal", "brand", "comparison", "non_food", "unclear"]),
  l3: z.array(z.string()), subcategories: z.array(z.string()), categories: z.array(z.string()),
  brands: z.array(z.string()), name_terms: z.array(z.string()),
  require: z.array(z.enum(CONCEPT_IDS)), exclude: z.array(z.enum(CONCEPT_IDS)),
  strict: z.boolean(),
  claims_required: z.array(z.enum(CLAIM_IDS)), claims_preferred: z.array(z.enum(CLAIM_IDS)),
  diet: z.object({ veg: z.boolean().optional(), vegan: z.boolean().optional(), jain: z.boolean().optional() }).strict(),
  numeric: z.array(z.object({ field: numericField, op: z.enum(["<=", ">=", "<", ">"]), value: z.number().finite() }).strict()),
  sort: z.object({ field: z.enum(["relevance", ...NUMERIC_FIELD_IDS]), dir: z.enum(["asc", "desc"]) }).strict(),
  semantic_query: z.string(), judge: z.array(z.string()), relax: z.array(z.string()),
  comparison: z.object({ reference: z.string(), field: numericField, dir: z.enum(["higher", "lower"]) }).strict().nullable(),
  summary: z.string(),
}).strict();
const cachedValueSchema = z.object({ plan: cachedPlanSchema, dropped: z.array(z.string()) });

export function planCacheKey(query: string, prefs: Preferences, promptFingerprint: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha1").update(JSON.stringify([normalized, prefs ?? null, promptFingerprint])).digest("hex");
}

export async function getCachedPlan(sql: Sql, key: string, signal?: AbortSignal): Promise<CachedPlan | null> {
  throwIfAborted(signal);
  const local = LOCAL.get(key);
  if (local && Date.now() < local.expiresAt) return structuredClone(local.value);
  if (local) LOCAL.delete(key);
  try {
    // scout_ro has SELECT only. Hit telemetry must not make reading the cache
    // require UPDATE permissions or acquire a row lock.
    const rows = await abortableQuery(sql<{ plan: unknown; dropped: unknown; created_at: Date }[]>`
      select plan, dropped, created_at from public.search_plan_cache
      where cache_key = ${key} and created_at > now() - make_interval(days => ${SHARED_TTL_DAYS})
      limit 1`, signal);
    if (!rows[0]) return null;
    const parsed = cachedValueSchema.safeParse(rows[0]);
    if (!parsed.success || parsed.data.dropped.includes("planner:degraded")) return null;
    const now = Date.now();
    const createdAt = new Date(rows[0].created_at).getTime();
    // A nearly expired shared row must not gain another six hours locally.
    const expiresAt = Math.min(now + LOCAL_TTL_MS, createdAt + SHARED_TTL_MS);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
    LOCAL.set(key, { expiresAt, value: parsed.data });
    return structuredClone(parsed.data);
  } catch {
    throwIfAborted(signal);
    return null; // A cache miss is always safe.
  }
}

export function storePlan(_sql: Sql, key: string, plan: SearchPlan, dropped: string[], signal?: AbortSignal, writer = writeSharedPlan): Promise<void> {
  throwIfAborted(signal);
  // Degraded plans are never reused; failures to write are harmless.
  if (dropped.includes("planner:degraded")) return Promise.resolve();
  const parsed = cachedValueSchema.safeParse({ plan, dropped });
  if (!parsed.success) return Promise.resolve();
  LOCAL.set(key, { expiresAt: Date.now() + LOCAL_TTL_MS, value: parsed.data });
  return writer({ cache_key: key, ...parsed.data }, signal).catch(() => {});
}
