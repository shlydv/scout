/** Scout Plus — India pricing (Razorpay amounts in paise). */

export type PlanInterval = "monthly" | "yearly";

export type ScoutPlan = {
  id: string;
  name: string;
  description: string;
  amount_paise: number;
  currency: "INR";
  interval: PlanInterval;
};

export const SCOUT_PLUS_PLAN: ScoutPlan & { free_daily_ai_searches: number } = {
  id: "scout_plus_monthly",
  name: "Scout Plus",
  description: "Unlimited Ask Scout AI, basket health reports, compare, alerts",
  amount_paise: 10_000, // ₹100 / month
  currency: "INR",
  interval: "monthly",
  /** Free tier AI searches per calendar day */
  free_daily_ai_searches: 5,
};

export const SCOUT_PLUS_YEARLY: ScoutPlan = {
  id: "scout_plus_yearly",
  name: "Scout Plus (yearly)",
  description: "Unlimited Ask Scout AI, basket health reports, compare, alerts — 2 months free",
  amount_paise: 100_000, // ₹1,000 / year
  currency: "INR",
  interval: "yearly",
};

export function planForInterval(interval: PlanInterval): ScoutPlan {
  return interval === "yearly" ? SCOUT_PLUS_YEARLY : SCOUT_PLUS_PLAN;
}

export function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
