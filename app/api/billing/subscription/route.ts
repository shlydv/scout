import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";

export const dynamic = "force-dynamic";

/** Current subscription status for the signed-in user (cancel UI). */
export async function GET(request: Request) {
  const client = supabaseFromBearer(request.headers.get("authorization"));
  if (!client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sub } = await adminClient()
    .from("subscriptions")
    .select("razorpay_subscription_id, status, current_period_end, razorpay_plan_id, updated_at")
    .eq("user_id", data.user.id)
    .in("status", ["active", "pending", "pending_cancellation"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    subscription: sub
      ? {
          id: sub.razorpay_subscription_id,
          status: sub.status,
          current_period_end: sub.current_period_end,
          plan_id: sub.razorpay_plan_id,
        }
      : null,
  });
}
