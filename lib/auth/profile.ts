import type { SupabaseClient } from "@supabase/supabase-js";
import { SCOUT_PLUS_PLAN } from "@/lib/billing/plans";

/** Admin emails with unlimited AI searches — set via UNLIMITED_EMAILS env var (comma-separated). */
const UNLIMITED_EMAILS = new Set(
  (process.env.UNLIMITED_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
);

export type UserProfile = {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  plan: "free" | "plus";
  ai_searches_remaining: number;
  ai_searches_limit: number;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getProfileForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, phone, full_name, plan, ai_searches_today, ai_searches_day")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;

  const day = todayUtc();
  let used = data.ai_searches_today ?? 0;
  if (data.ai_searches_day !== day) used = 0;

  // Check subscription expiry: if plan is "plus" but period has lapsed, downgrade
  let plan = (data.plan === "plus" ? "plus" : "free") as "free" | "plus";
  if (plan === "plus" && !UNLIMITED_EMAILS.has((data.email ?? "").toLowerCase())) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("current_period_end, status")
      .eq("user_id", userId)
      .in("status", ["active", "pending_cancellation"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sub?.current_period_end && new Date(sub.current_period_end) < new Date()) {
      plan = "free";
      // Silently fix stale profile
      await supabase
        .from("profiles")
        .update({ plan: "free", updated_at: new Date().toISOString() })
        .eq("id", userId);
    }
  }

  const isUnlimited = plan === "plus" || UNLIMITED_EMAILS.has((data.email ?? "").toLowerCase());
  const limit = isUnlimited ? 9999 : SCOUT_PLUS_PLAN.free_daily_ai_searches;
  const remaining = isUnlimited ? 9999 : Math.max(0, limit - used);

  return {
    id: data.id,
    email: data.email,
    phone: data.phone,
    full_name: data.full_name,
    plan,
    ai_searches_remaining: remaining,
    ai_searches_limit: limit,
  };
}

export async function consumeAiSearch(
  supabase: SupabaseClient,
  userId: string,
  authEmail?: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const profile = await getProfileForUser(supabase, userId);
  if (!profile) return { ok: false, reason: "Profile not found" };
  
  // Check unlimited at runtime (not module init) to ensure env var is fresh
  const runtimeUnlimited = new Set(
    (process.env.UNLIMITED_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
  );
  const isAdmin = runtimeUnlimited.has((profile.email ?? "").toLowerCase()) ||
                  (authEmail ? runtimeUnlimited.has(authEmail.toLowerCase()) : false);
  
  if (profile.plan === "plus" || isAdmin) return { ok: true };
  if (profile.ai_searches_remaining <= 0) {
    return { ok: false, reason: "Daily AI search limit reached. Upgrade to Scout Plus." };
  }

  const day = todayUtc();
  const { data } = await supabase
    .from("profiles")
    .select("ai_searches_today, ai_searches_day")
    .eq("id", userId)
    .single();

  const used =
    data?.ai_searches_day === day ? (data.ai_searches_today ?? 0) + 1 : 1;

  await supabase
    .from("profiles")
    .update({
      ai_searches_today: used,
      ai_searches_day: day,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return { ok: true };
}

export async function setUserPlanPlus(
  supabase: SupabaseClient,
  userId: string,
  razorpaySubscriptionId: string,
  periodEnd?: string | null,
): Promise<void> {
  await supabase
    .from("profiles")
    .update({ plan: "plus", updated_at: new Date().toISOString() })
    .eq("id", userId);

  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      razorpay_subscription_id: razorpaySubscriptionId,
      status: "active",
      current_period_end: periodEnd ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "razorpay_subscription_id" },
  );
}
