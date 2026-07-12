import type { Metadata } from "next";
import { PlanCards } from "@/components/plan-cards";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Pricing · Scout",
  description:
    "Scout is free to browse. Scout Plus unlocks unlimited Ask Scout AI, basket health reports, and saved-search alerts — ₹100/month or ₹1,000/year.",
};

export default function PricingPage() {
  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="mx-auto max-w-4xl px-5 pb-24 pt-12 md:px-6 md:pt-16">
        <header className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-(--color-fg-dim)">
            Pricing
          </p>
          <h1 className="font-display mx-auto mt-3 max-w-xl text-balance text-4xl leading-tight md:text-5xl">
            Cheaper than one bad grocery run.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-(--color-fg-muted)">
            Scout reads every back label in the catalog so you don&apos;t have to. Plus members get
            the full intelligence layer — unlimited AI search, basket reports, and alerts.
          </p>
        </header>

        <div className="mt-10">
          <PlanCards />
        </div>

        <div className="mx-auto mt-14 max-w-2xl rounded-2xl border border-(--color-line) bg-(--color-bg-soft) p-5 text-center">
          <p className="text-[14px] leading-relaxed text-(--color-fg-muted)">
            <strong className="text-(--color-fg)">Why paid?</strong> Scout takes no brand money and
            shows no ads — the score can never be bought. Subscriptions are the only thing that
            keeps it that way.
          </p>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
