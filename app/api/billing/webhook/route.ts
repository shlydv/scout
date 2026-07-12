import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { setUserPlanPlus } from "@/lib/auth/profile";
import { verifyWebhookSignature } from "@/lib/billing/razorpay";

export const dynamic = "force-dynamic";

type RazorpayWebhook = {
  event: string;
  payload?: {
    subscription?: { entity?: { id?: string; status?: string; current_end?: number } };
    payment?: { entity?: { id?: string; order_id?: string; status?: string } };
    order?: { entity?: { id?: string; notes?: Record<string, string>; amount?: number } };
  };
};

function periodEndFromInterval(interval: string | undefined): string {
  const end = new Date();
  if (interval === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: RazorpayWebhook;
  try {
    body = JSON.parse(raw) as RazorpayWebhook;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = body.event;
  const admin = adminClient();
  const subEntity = body.payload?.subscription?.entity;
  const subId = subEntity?.id;
  if (!subId) {
    // Legacy Standard Checkout (one-time orders) — grant Plus for one billing period.
    if (event === "order.paid" || event === "payment.captured") {
      const orderId = body.payload?.order?.entity?.id ?? body.payload?.payment?.entity?.order_id;
      const notes = body.payload?.order?.entity?.notes;
      const userId = notes?.user_id;
      if (orderId && userId) {
        try {
          const periodEnd = periodEndFromInterval(notes?.interval);
          await setUserPlanPlus(admin, userId, orderId, periodEnd);
          await admin.from("subscriptions").update({
            status: "active",
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          }).eq("razorpay_subscription_id", orderId);
        } catch (e) {
          console.error("[webhook] order.paid db failed:", e);
          return NextResponse.json({ error: "Internal" }, { status: 500 });
        }
      }
    }
    return NextResponse.json({ ok: true });
  }

  let row: { user_id: string } | undefined;
  try {
    const result = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("razorpay_subscription_id", subId)
      .maybeSingle();
    row = result.data ?? undefined;
  } catch (e) {
    console.error("[webhook] subscription lookup failed:", e);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }

  if (!row?.user_id) {
    return NextResponse.json({ ok: true });
  }

  const activeEvents = new Set([
    "subscription.authenticated",
    "subscription.activated",
    "subscription.charged",
  ]);
  const cancelEvents = new Set([
    "subscription.cancelled",
    "subscription.halted",
    "subscription.completed",
  ]);

  try {
    if (activeEvents.has(event)) {
      const periodEnd = subEntity?.current_end
        ? new Date(subEntity.current_end * 1000).toISOString()
        : null;
      await setUserPlanPlus(admin, row.user_id, subId, periodEnd);
      await admin
        .from("subscriptions")
        .update({
          status: subEntity?.status ?? "active",
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_subscription_id", subId);
    } else if (cancelEvents.has(event)) {
      await admin
        .from("profiles")
        .update({ plan: "free", updated_at: new Date().toISOString() })
        .eq("id", row.user_id);
      await admin
        .from("subscriptions")
        .update({
          status: subEntity?.status ?? "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_subscription_id", subId);
    }
  } catch (e) {
    console.error("[webhook] db update failed:", e);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
