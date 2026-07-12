import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";

const RAZORPAY_BASE = "https://api.razorpay.com/v1";

export async function POST(request: Request) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json(
      { error: "Billing is not configured yet." },
      { status: 503 },
    );
  }

  const client = supabaseFromBearer(request.headers.get("authorization"));
  if (!client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: auth, error: authErr } = await client.auth.getUser();
  if (authErr || !auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cancel_at_cycle_end } = (await request.json().catch(() => ({}))) as {
    cancel_at_cycle_end?: boolean;
  };
  // Default: keep Plus until the paid period ends (matches "cancel anytime").
  const atCycleEnd = cancel_at_cycle_end !== false;

  const admin = adminClient();

  const { data: sub } = await admin
    .from("subscriptions")
    .select("razorpay_subscription_id, status, current_period_end")
    .eq("user_id", auth.user.id)
    .in("status", ["active", "pending", "pending_cancellation"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub?.razorpay_subscription_id) {
    return NextResponse.json({ error: "No active subscription found" }, { status: 404 });
  }

  const subId = sub.razorpay_subscription_id;
  const isLegacyOrder = subId.startsWith("order_");

  const authHeader = `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;

  try {
    if (!isLegacyOrder) {
      const cancelRes = await fetch(
        `${RAZORPAY_BASE}/subscriptions/${subId}/cancel`,
        {
          method: "POST",
          headers: { authorization: authHeader, "content-type": "application/json" },
          body: JSON.stringify({ cancel_at_cycle_end: atCycleEnd }),
        },
      );

      if (!cancelRes.ok) {
        const errBody = await cancelRes.json().catch(() => ({}));
        const msg =
          typeof errBody === "object" && errBody && "error" in errBody
            ? JSON.stringify((errBody as { error: unknown }).error)
            : cancelRes.statusText;
        return NextResponse.json(
          { error: `Razorpay cancellation failed: ${msg}` },
          { status: 502 },
        );
      }
    }

    if (atCycleEnd && !isLegacyOrder) {
      await admin
        .from("subscriptions")
        .update({
          status: "pending_cancellation",
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_subscription_id", subId);
      return NextResponse.json({
        ok: true,
        status: "pending_cancellation",
        current_period_end: sub.current_period_end,
      });
    }

    // Immediate cancel (or legacy one-time order): drop Plus now.
    await admin
      .from("profiles")
      .update({ plan: "free", updated_at: new Date().toISOString() })
      .eq("id", auth.user.id);

    await admin
      .from("subscriptions")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("razorpay_subscription_id", subId);

    return NextResponse.json({ ok: true, status: "cancelled" });
  } catch (e) {
    console.error("[billing/cancel-subscription]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "Cancellation failed — please try again or contact support." },
      { status: 502 },
    );
  }
}
