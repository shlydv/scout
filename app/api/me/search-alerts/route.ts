import { NextRequest, NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/auth/require-user";
import { dueAlerts, listAlerts, runAlerts } from "@/lib/search/alerts/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** List the user's switched-on alerts. */
export async function GET(req: NextRequest) {
  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  try {
    return NextResponse.json({ alerts: await listAlerts(authed.user.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not list alerts" }, { status: 500 });
  }
}

/**
 * Run the user's alerts now; returns the ones that found products they have not been
 * told about before.
 */
export async function POST(req: NextRequest) {
  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  try {
    const triggered = await runAlerts(await dueAlerts({ userId: authed.user.id }));
    const updates = triggered.map(({ id, query, new_matches, previous }) => ({
      id,
      query,
      new_matches,
      previous,
    }));
    return NextResponse.json({ triggered: updates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Alert run failed" }, { status: 500 });
  }
}
