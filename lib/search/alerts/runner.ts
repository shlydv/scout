import { adminClient } from "@/lib/supabase/admin";
import type { AiSearchPreferences } from "@/lib/search/preferences";
import { plannedSearch } from "@/lib/search/planned/search";
import { deliverAlertTriggers } from "@/lib/search/alerts/notify";

export type AlertRecord = {
  id: string;
  user_id: string;
  saved_search_id?: string | null;
  query: string;
  preferences: unknown;
  last_match_count: number | null;
  last_notified_at: string | null;
};

export type AlertTrigger = {
  id: string;
  user_id: string;
  query: string;
  new_matches: number;
  previous: number;
};

/** Run V2 search for each alert and update match counts; returns newly triggered alerts. */
export async function runAlertsForRecords(alerts: AlertRecord[]): Promise<AlertTrigger[]> {
  const supabase = adminClient();
  const triggered: AlertTrigger[] = [];

  for (const alert of alerts) {
    // Per-alert isolation: one bad query/timeout must not abort the whole cron sweep.
    try {
      const prefs = (alert.preferences as Record<string, unknown>) ?? {};
      const result = await plannedSearch(String(alert.query), {
        limit: 12,
        preferences: prefs as AiSearchPreferences,
      });
      const count = result.items.length;
      const prev = Number(alert.last_match_count ?? 0);
      const hasNew = count > prev;

      const now = new Date().toISOString();
      await supabase
        .from("search_alerts")
        .update({
          last_match_count: count,
          last_notified_at: hasNew ? now : alert.last_notified_at,
        })
        .eq("id", alert.id);

      if (alert.saved_search_id) {
        await supabase
          .from("saved_searches")
          .update({ last_run_at: now, updated_at: now })
          .eq("id", alert.saved_search_id);
      }

      if (hasNew) {
        triggered.push({
          id: String(alert.id),
          user_id: String(alert.user_id),
          query: String(alert.query),
          new_matches: count,
          previous: prev,
        });
      }
    } catch (err) {
      console.error(
        "[alerts] alert failed, continuing:",
        alert.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (triggered.length) {
    await deliverAlertTriggers(triggered);
  }

  return triggered;
}

/** Process all active alerts (cron). */
export async function runAllActiveAlerts(opts?: { limit?: number }) {
  const supabase = adminClient();
  let query = supabase.from("search_alerts").select("*").eq("active", true);
  if (opts?.limit) query = query.limit(opts.limit);
  const { data: alerts, error } = await query;
  if (error) throw new Error(error.message);

  const triggered = await runAlertsForRecords((alerts ?? []) as AlertRecord[]);
  return { processed: alerts?.length ?? 0, triggered };
}
