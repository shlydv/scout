import type { AiSearchPreferences } from "@/lib/search/preferences";
import { plannedSearch } from "@/lib/search/planned/search";
import { searchSql, type Sql } from "@/lib/search/planned/db";
import { emailAlertTriggers } from "@/lib/search/alerts/notify";

/** A saved search with its alert switched on. */
export type DueAlert = {
  saved_search_id: string;
  user_id: string;
  query: string;
  preferences: unknown;
};

export type AlertTrigger = {
  id: string;
  user_id: string;
  query: string;
  new_matches: number;
  previous: number;
};

const SEEN_LIMIT = 1000;

/**
 * Products in this run that the alert has not reported before. The first run (seen is null)
 * only records what matches now, so turning an alert on never reports existing products.
 */
export function newMatches(current: string[], seen: string[] | null): { fresh: string[]; seen: string[] } {
  const ids = [...new Set(current)];
  if (seen === null) return { fresh: [], seen: ids.slice(0, SEEN_LIMIT) };
  const known = new Set(seen);
  const fresh = ids.filter(id => !known.has(id));
  return { fresh, seen: [...fresh, ...seen].slice(0, SEEN_LIMIT) };
}

/**
 * Run each alert and record the outcome. The notification and the alert's new state are
 * written in one transaction on the alert's row, so a failed write reports nothing and
 * leaves the alert to report the same products next run, and two overlapping runs cannot
 * both report them. Email goes out after the commit and never changes the state.
 */
export async function runAlerts(
  alerts: DueAlert[],
  { sql = searchSql(), search = plannedSearch, email = emailAlertTriggers }:
    { sql?: Sql; search?: typeof plannedSearch; email?: typeof emailAlertTriggers } = {},
): Promise<AlertTrigger[]> {
  const triggered: AlertTrigger[] = [];

  for (const alert of alerts) {
    // Per-alert isolation: one bad query/timeout must not abort the whole cron sweep.
    try {
      const prefs = (alert.preferences as Record<string, unknown>) ?? {};
      const result = await search(alert.query, {
        limit: 12,
        preferences: prefs as AiSearchPreferences,
      });
      const ids = result.items.map(i => i.product_id);

      const trigger = await sql.begin(async tx => {
        const [state] = await tx<{ id: string; seen_product_ids: string[] | null; last_match_count: number }[]>`
          insert into public.search_alerts (user_id, saved_search_id, query, preferences)
          values (${alert.user_id}, ${alert.saved_search_id}, ${alert.query}, ${tx.json(prefs as never)})
          on conflict (saved_search_id) do update set query = excluded.query, preferences = excluded.preferences
          returning id, seen_product_ids, last_match_count`;
        const { fresh, seen } = newMatches(ids, state!.seen_product_ids);
        const hit: AlertTrigger | null = fresh.length
          ? { id: state!.id, user_id: alert.user_id, query: alert.query, new_matches: fresh.length, previous: state!.last_match_count }
          : null;
        if (hit) {
          await tx`
            insert into public.alert_notifications (user_id, alert_id, query, new_matches, previous)
            values (${hit.user_id}, ${hit.id}, ${hit.query}, ${hit.new_matches}, ${hit.previous})`;
        }
        await tx`
          update public.search_alerts
          set seen_product_ids = ${seen}::uuid[], last_match_count = ${ids.length},
              last_notified_at = ${hit ? tx`now()` : tx`last_notified_at`}
          where id = ${state!.id}`;
        await tx`update public.saved_searches set last_run_at = now(), updated_at = now() where id = ${alert.saved_search_id}`;
        return hit;
      });
      if (trigger) triggered.push(trigger);
    } catch (err) {
      console.error(
        "[alerts] alert failed, continuing:",
        alert.saved_search_id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (triggered.length) {
    await email(triggered);
  }

  return triggered;
}

/** Saved searches with their alert on: everyone's (cron) or one shopper's. */
export async function dueAlerts(opts: { userId?: string; limit?: number } = {}): Promise<DueAlert[]> {
  const sql = searchSql();
  return sql<DueAlert[]>`
    select id saved_search_id, user_id, query, preferences
    from public.saved_searches
    where alert_enabled ${opts.userId ? sql`and user_id = ${opts.userId}` : sql``}
    order by last_run_at asc nulls first
    ${opts.limit ? sql`limit ${opts.limit}` : sql``}`;
}

/** Process all switched-on alerts (cron). */
export async function runAllActiveAlerts(opts?: { limit?: number }) {
  const alerts = await dueAlerts({ limit: opts?.limit });
  const triggered = await runAlerts(alerts);
  return { processed: alerts.length, triggered };
}

/** One shopper's switched-on alerts with what they last found. */
export async function listAlerts(userId: string) {
  const sql = searchSql();
  return sql`
    select s.id saved_search_id, s.query, s.preferences, s.created_at, s.last_run_at,
           a.last_match_count, a.last_notified_at
    from public.saved_searches s
    left join public.search_alerts a on a.saved_search_id = s.id
    where s.user_id = ${userId} and s.alert_enabled
    order by s.created_at desc`;
}
