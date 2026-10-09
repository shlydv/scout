import { NextRequest, NextResponse } from "next/server";
import { runAllActiveAlerts } from "@/lib/search/alerts/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Daily alert sweep — wire to Vercel Cron or external scheduler.
 *   GET /api/cron/search-alerts
 *   Authorization: Bearer $CRON_SECRET
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const { processed, triggered } = await runAllActiveAlerts(
      limit && Number.isFinite(limit) ? { limit } : undefined,
    );
    return NextResponse.json({
      ok: true,
      processed,
      triggered_count: triggered.length,
      triggered,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Alert run failed" },
      { status: 500 },
    );
  }
}
