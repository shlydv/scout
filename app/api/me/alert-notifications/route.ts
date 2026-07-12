import { NextRequest, NextResponse } from "next/server";
import { requirePlusUser } from "@/lib/auth/require-plus";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** List unread (and recent) in-app alert notifications for Plus users. */
export async function GET(req: NextRequest) {
  const authed = await requirePlusUser(req);
  if (authed instanceof NextResponse) return authed;

  const { data, error } = await adminClient()
    .from("alert_notifications")
    .select("id, query, new_matches, previous, created_at, read_at")
    .eq("user_id", authed.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    // Table may not be migrated yet — fail soft.
    if (/alert_notifications|does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ notifications: [], pending_migration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notifications: data ?? [] });
}

/** Mark notifications read. Body: { ids?: string[], all?: boolean } */
export async function POST(req: NextRequest) {
  const authed = await requirePlusUser(req);
  if (authed instanceof NextResponse) return authed;

  const body = (await req.json().catch(() => ({}))) as {
    ids?: string[];
    all?: boolean;
  };

  const now = new Date().toISOString();
  let query = adminClient()
    .from("alert_notifications")
    .update({ read_at: now })
    .eq("user_id", authed.user.id)
    .is("read_at", null);

  if (!body.all && body.ids?.length) {
    query = query.in("id", body.ids);
  } else if (!body.all) {
    return NextResponse.json({ error: "ids or all required" }, { status: 400 });
  }

  const { error } = await query;
  if (error) {
    if (/alert_notifications|does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ ok: true, pending_migration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
