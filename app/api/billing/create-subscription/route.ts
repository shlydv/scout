import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { formatInr, planForInterval, type PlanInterval } from "@/lib/billing/plans";
import {
  createRazorpayCustomer,
  createRazorpaySubscription,
  ensureRazorpayPlan,
} from "@/lib/billing/razorpay";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const client = supabaseFromBearer(request.headers.get("authorization"));
  if (!client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Launch-day graceful degrade: billing env may land after the first deploy.
  // Without this, authHeader() throws and the upgrade click 500s in the user's face.
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json(
      { error: "Payments are opening shortly — check back soon." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { interval?: string };
  const interval: PlanInterval = body.interval === "yearly" ? "yearly" : "monthly";
  const plan = planForInterval(interval);

  const admin = adminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("razorpay_customer_id, full_name, email, phone, plan")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile?.plan === "plus") {
    return NextResponse.json({ error: "Already subscribed" }, { status: 400 });
  }

  try {
    let customerId = profile?.razorpay_customer_id as string | null;
    if (!customerId) {
      customerId = await createRazorpayCustomer({
        name: profile?.full_name ?? data.user.user_metadata?.full_name,
        email: profile?.email ?? data.user.email,
        contact: profile?.phone ?? data.user.phone,
      });
      await admin
        .from("profiles")
        .update({ razorpay_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", data.user.id);
    }

    const planId = await ensureRazorpayPlan(interval);
    // ~10 years of renewals; cancel anytime from profile.
    const totalCount = interval === "yearly" ? 10 : 120;
    const subscription = await createRazorpaySubscription({
      customerId,
      planId,
      totalCount,
      notes: { user_id: data.user.id, plan: plan.id, interval },
    });

    await admin.from("subscriptions").upsert(
      {
        user_id: data.user.id,
        razorpay_subscription_id: subscription.id,
        razorpay_plan_id: planId,
        status: "pending",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "razorpay_subscription_id" },
    );

    return NextResponse.json({
      subscription_id: subscription.id,
      checkout_url: subscription.short_url ?? null,
      key_id: process.env.RAZORPAY_KEY_ID,
      amount: plan.amount_paise,
      currency: plan.currency,
      plan: {
        name: plan.name,
        amount_display: formatInr(plan.amount_paise),
        interval: plan.interval,
      },
    });
  } catch (e) {
    console.error("[billing/create-subscription]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "Could not start checkout — please try again in a few minutes." },
      { status: 502 },
    );
  }
}
