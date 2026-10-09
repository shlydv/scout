import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { requireAuthedUser } from "@/lib/auth/require-user";
import type { AiSearchPreferences } from "@/lib/search/preferences";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  const { data, error } = await adminClient()
    .from("saved_searches")
    .select("id, label, query, preferences, alert_enabled, last_run_at, created_at, updated_at")
    .eq("user_id", authed.user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved_searches: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    query?: string;
    label?: string;
    preferences?: AiSearchPreferences | null;
    alert_enabled?: boolean;
  } | null;

  const query = body?.query?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  const wantsAlert = Boolean(body?.alert_enabled);
  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  const { data, error } = await adminClient()
    .from("saved_searches")
    .insert({
      user_id: authed.user.id,
      query: query.slice(0, 200),
      label: body?.label?.trim()?.slice(0, 80) ?? query.slice(0, 80),
      preferences: body?.preferences ?? {},
      alert_enabled: wantsAlert,
    })
    .select("id, label, query, preferences, alert_enabled, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (wantsAlert) {
    await adminClient().from("search_alerts").insert({
      user_id: authed.user.id,
      saved_search_id: data.id,
      query: data.query,
      preferences: data.preferences ?? {},
      active: true,
    });
  }

  return NextResponse.json({ saved_search: data });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    label?: string;
    alert_enabled?: boolean;
  } | null;

  const id = body?.id?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  const supabase = adminClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.label !== undefined) patch.label = body.label.trim().slice(0, 80);
  if (body?.alert_enabled !== undefined) patch.alert_enabled = Boolean(body.alert_enabled);

  const { data, error } = await supabase
    .from("saved_searches")
    .update(patch)
    .eq("id", id)
    .eq("user_id", authed.user.id)
    .select("id, label, query, preferences, alert_enabled, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body?.alert_enabled === true) {
    const { data: existing } = await supabase
      .from("search_alerts")
      .select("id")
      .eq("saved_search_id", id)
      .eq("user_id", authed.user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from("search_alerts").update({ active: true }).eq("id", existing.id);
    } else {
      await supabase.from("search_alerts").insert({
        user_id: authed.user.id,
        saved_search_id: id,
        query: data.query,
        preferences: data.preferences ?? {},
        active: true,
      });
    }
  } else if (body?.alert_enabled === false) {
    await supabase
      .from("search_alerts")
      .update({ active: false })
      .eq("saved_search_id", id)
      .eq("user_id", authed.user.id);
  }

  return NextResponse.json({ saved_search: data });
}

export async function DELETE(req: NextRequest) {
  const authed = await requireAuthedUser(req);
  if (authed instanceof NextResponse) return authed;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await adminClient().from("saved_searches").delete().eq("id", id).eq("user_id", authed.user.id);
  return NextResponse.json({ ok: true });
}
