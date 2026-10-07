import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { requireAuthedUser } from "@/lib/auth/require-user";
import { runAlertsForRecords, type AlertRecord } from "@/lib/search/v2/alert-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** List active alerts for the user. */
export async function GET(req: NextRequest) {
  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  const { data, error } = await adminClient()
    .from("search_alerts")
    .select("id, query, preferences, last_match_count, last_notified_at, active, created_at, saved_search_id")
    .eq("user_id", authed.user.id)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: data ?? [] });
}

/**
 * Run alert checks — compares current result count vs last notified.
 * Call from cron or manually; returns alerts with new matches.
 */
export async function POST(req: NextRequest) {
  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  const supabase = adminClient();
  const { data: alerts } = await supabase
    .from("search_alerts")
    .select("*")
    .eq("user_id", authed.user.id)
    .eq("active", true);

  const triggered = await runAlertsForRecords((alerts ?? []) as AlertRecord[]);
  const updates = triggered.map(({ id, query, new_matches, previous }) => ({
    id,
    query,
    new_matches,
    previous,
  }));

  return NextResponse.json({ triggered: updates });
}
