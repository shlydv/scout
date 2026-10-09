/**
 * Two-level plan cache: in-process map (instant) backed by search_plan_cache
 * (shared across serverless instances). Keys include a hash of the planner
 * prompt, so prompt or vocabulary changes invalidate old plans automatically.
 */
import crypto from "node:crypto";
import type { Sql } from "./db";
import type { Preferences, SearchPlan } from "./plan";

const LOCAL = new Map<string, { at: number; plan: SearchPlan; dropped: string[] }>();
const LOCAL_TTL_MS = 6 * 60 * 60_000;
const SHARED_TTL_DAYS = 3;

export function planCacheKey(query: string, prefs: Preferences, promptFingerprint: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha1").update(JSON.stringify([normalized, prefs ?? null, promptFingerprint])).digest("hex");
}

export async function getCachedPlan(sql: Sql, key: string): Promise<{ plan: SearchPlan; dropped: string[] } | null> {
  const local = LOCAL.get(key);
  if (local && Date.now() - local.at < LOCAL_TTL_MS) return local;
  try {
    const rows = await sql<{ plan: SearchPlan; dropped: string[] }[]>`
      update public.search_plan_cache set hits = hits + 1, last_hit_at = now()
      where cache_key = ${key} and created_at > now() - make_interval(days => ${SHARED_TTL_DAYS})
      returning plan, dropped`;
    if (!rows[0]) return null;
    LOCAL.set(key, { at: Date.now(), ...rows[0] });
    return rows[0];
  } catch {
    return null; // A cache miss is always safe.
  }
}

export function storePlan(sql: Sql, key: string, plan: SearchPlan, dropped: string[]): void {
  LOCAL.set(key, { at: Date.now(), plan, dropped });
  // Degraded plans are never shared; failures to write are harmless.
  if (dropped.includes("planner:degraded")) return;
  void sql`
    insert into public.search_plan_cache (cache_key, plan, dropped)
    values (${key}, ${sql.json(plan as never)}, ${dropped}::text[])
    on conflict (cache_key) do update set plan = excluded.plan, dropped = excluded.dropped, created_at = now(), hits = 0`
    .catch(() => {});
}
