"use client";

import Link from "next/link";
import { UserRound, X } from "lucide-react";

/** Shown when an anonymous visitor uses up the free Ask Scout searches —
 *  the single conversion moment for signed-out traffic, so treat it as an
 *  invitation, not an error (mirrors AiQuotaCard). */
export function SignInGateCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="relative mt-3 rounded-2xl border p-4"
      style={{
        borderColor: "color-mix(in srgb, var(--color-accent) 40%, var(--color-line))",
        backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, var(--color-panel))",
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full text-(--color-fg-dim) hover:text-(--color-fg)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-accent) 14%, var(--color-panel))",
            color: "var(--color-accent)",
          }}
        >
          <UserRound className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-(--color-fg)">
            That&apos;s all 3 free searches for now
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-(--color-fg-muted)">
            Sign in for 5 Ask Scout searches a day — free. Upgrade to Plus anytime for
            unlimited searches, alerts, and basket health reports. Browsing and filters
            never need an account.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-xl bg-(--color-fg) px-4 py-2 text-[13px] font-semibold text-(--color-bg) transition hover:opacity-90"
            >
              <UserRound className="h-3.5 w-3.5" />
              Sign in — it&apos;s free
            </Link>
            <button
              type="button"
              onClick={onDismiss}
              className="text-[13px] text-(--color-fg-muted) underline-offset-4 hover:text-(--color-fg) hover:underline"
            >
              Browse with filters instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
