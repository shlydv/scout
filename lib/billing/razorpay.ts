import crypto from "node:crypto";
import { planForInterval, type PlanInterval } from "@/lib/billing/plans";

const RAZORPAY_BASE = "https://api.razorpay.com/v1";

function authHeader(): string {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required");
  }
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function razorpayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RAZORPAY_BASE}${path}`, {
    ...init,
    headers: {
      authorization: authHeader(),
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : res.statusText;
    throw new Error(`Razorpay ${path}: ${msg}`);
  }
  return body as T;
}

export type RazorpaySubscriptionCreate = {
  id: string;
  short_url?: string;
  status: string;
};

/** Create or reuse the Razorpay plan for the requested billing interval. */
export async function ensureRazorpayPlan(interval: PlanInterval = "monthly"): Promise<string> {
  const envPlanId =
    interval === "yearly"
      ? process.env.RAZORPAY_PLAN_ID_YEARLY
      : process.env.RAZORPAY_PLAN_ID;
  if (envPlanId) return envPlanId;

  const plan = planForInterval(interval);
  const created = await razorpayFetch<{ id: string }>("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: interval,
      interval: 1,
      item: {
        name: plan.name,
        amount: plan.amount_paise,
        currency: plan.currency,
        description: plan.description,
      },
    }),
  });
  return created.id;
}

export async function createRazorpayCustomer(opts: {
  name?: string | null;
  email?: string | null;
  contact?: string | null;
}): Promise<string> {
  const customer = await razorpayFetch<{ id: string }>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name ?? "Scout user",
      email: opts.email ?? undefined,
      contact: opts.contact ?? undefined,
      fail_existing: "0",
    }),
  });
  return customer.id;
}

/** Subscription with UPI / card mandate support (customer completes auth on Razorpay). */
export async function createRazorpaySubscription(opts: {
  customerId: string;
  planId: string;
  totalCount?: number;
  notes?: Record<string, string>;
}): Promise<RazorpaySubscriptionCreate> {
  return razorpayFetch<RazorpaySubscriptionCreate>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: opts.planId,
      customer_id: opts.customerId,
      total_count: opts.totalCount ?? 120,
      customer_notify: 1,
      quantity: 1,
      notes: opts.notes,
    }),
  });
}

export function verifyRazorpaySignature(opts: {
  subscriptionId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const payload = `${opts.paymentId}|${opts.subscriptionId}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return expected === opts.signature;
}

export function verifyWebhookSignature(body: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return expected === signature;
}
