"use client";

import Script from "next/script";
import Link from "next/link";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import {
  SCOUT_PLUS_PLAN,
  SCOUT_PLUS_YEARLY,
  formatInr,
  type PlanInterval,
} from "@/lib/billing/plans";

declare global { interface Window { Razorpay: any } }

function openRazorpayCheckout(data: {
  subscription_id: string;
  key_id: string;
}) {
  const rzp = new window.Razorpay({
    key: data.key_id,
    subscription_id: data.subscription_id,
    name: "Scout",
    description: "Scout Plus",
    handler: () => window.location.reload(),
    prefill: {},
    theme: { color: "#111" },
  });
  rzp.open();
}

const FREE_FEATURES = [
  "Full catalog with scores and verdicts",
  `${SCOUT_PLUS_PLAN.free_daily_ai_searches} Ask Scout AI searches a day`,
  "Basket analysis with swap suggestions",
  "Compare up to 4 products",
];

const PLUS_FEATURES = [
  "Unlimited Ask Scout AI searches",
  "Saved-search alerts when new matches appear",
  "Basket health report with swap impact",
  "Early access to new intelligence features",
  "Support an independent, ad-free Scout",
];

export function PlanCards() {
  const { session, profile, ready } = useAuth();
  const [interval, setInterval] = useState<PlanInterval>("yearly");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPlus = profile?.plan === "plus";
  const monthly = SCOUT_PLUS_PLAN.amount_paise;
  const yearly = SCOUT_PLUS_YEARLY.amount_paise;
  const yearlySavingsPct = Math.round((1 - yearly / (monthly * 12)) * 100);

  const startCheckout = async () => {
    if (!session?.access_token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ interval }),
      });
      const data = (await res.json()) as {
        subscription_id?: string;
        key_id?: string;
        checkout_url?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.subscription_id && data.key_id && typeof window.Razorpay === "function") {
        openRazorpayCheckout({
          subscription_id: data.subscription_id,
          key_id: data.key_id,
        });
      } else if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error("Checkout unavailable — try again.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div>
      {/* Interval toggle */}
      <div className="mx-auto flex w-fit items-center rounded-full border border-(--color-line) bg-(--color-panel) p-1">
        {(["monthly", "yearly"] as const).map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setInterval(i)}
            aria-pressed={interval === i}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              interval === i
                ? "bg-(--color-fg) text-(--color-bg)"
                : "text-(--color-fg-muted) hover:text-(--color-fg)"
            }`}
          >
            {i === "monthly" ? "Monthly" : `Yearly · save ${yearlySavingsPct}%`}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {/* Free */}
        <div className="rounded-2xl border border-(--color-line) bg-(--color-panel) p-6">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-(--color-fg-muted)">
            Free
          </p>
          <p className="mt-3 font-display text-4xl">₹0</p>
          <p className="mt-1 text-[13px] text-(--color-fg-dim)">forever</p>
          <ul className="mt-6 space-y-2.5">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[14px] text-(--color-fg-muted)">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-dim)" />
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Link
              href="/search"
              className="inline-flex w-full items-center justify-center rounded-xl border border-(--color-line) px-5 py-2.5 text-sm font-medium text-(--color-fg) transition hover:border-(--color-fg-muted) hover:bg-(--color-bg-soft)"
            >
              Keep browsing free
            </Link>
          </div>
        </div>

        {/* Plus */}
        <div
          className="relative rounded-2xl border p-6"
          style={{
            borderColor: "color-mix(in srgb, var(--color-accent) 45%, var(--color-line))",
            backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, var(--color-panel))",
          }}
        >
          <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-(--color-fg) px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-(--color-bg)">
            <Sparkles className="h-3 w-3" />
            Scout Plus
          </span>
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-(--color-accent)">
            Plus
          </p>
          <p className="mt-3 font-display text-4xl">
            {interval === "yearly" ? formatInr(yearly) : formatInr(monthly)}
            <span className="ml-1 text-base text-(--color-fg-dim)">
              /{interval === "yearly" ? "year" : "month"}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-(--color-fg-dim)">
            {interval === "yearly"
              ? `${formatInr(Math.round(yearly / 12))}/month, billed yearly`
              : "cancel anytime"}
          </p>
          <ul className="mt-6 space-y-2.5">
            {PLUS_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[14px] text-(--color-fg)">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--color-good)" />
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            {isPlus ? (
              <p className="rounded-xl border border-(--color-good) px-5 py-2.5 text-center text-sm font-medium text-(--color-good)">
                You&apos;re on Plus — thank you!
              </p>
            ) : session ? (
              <button
                type="button"
                onClick={startCheckout}
                disabled={submitting || !ready}
                className="w-full rounded-xl bg-(--color-fg) px-5 py-2.5 text-sm font-semibold text-(--color-bg) transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              >
                {submitting ? "Opening checkout…" : "Start Scout Plus"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-xl bg-(--color-fg) px-5 py-2.5 text-sm font-semibold text-(--color-bg) transition hover:opacity-90"
              >
                Sign in to upgrade
              </Link>
            )}
            {error ? <p className="mt-2 text-center text-[12px] text-(--color-bad)">{error}</p> : null}
            <p className="mt-3 text-center text-[11px] text-(--color-fg-dim)">
              UPI, cards & netbanking via Razorpay · cancel anytime
            </p>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
