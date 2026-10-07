import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const revalidate = 86400;

export const metadata = { title: "Terms & Conditions · Scout" };

export default function TermsPage() {
  return (
    <main className="min-h-screen">
      <SiteNav />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-3xl">Terms &amp; Conditions</h1>
        <p className="mt-2 text-sm text-(--color-fg-muted)">Last updated: October 2026</p>

        <section className="mt-8 space-y-4 text-(--color-fg-muted)">
          <h2 className="font-semibold text-(--color-fg)">Use of service</h2>
          <p>Scout provides nutrition information and product recommendations. Scores are algorithmic estimates based on ingredient labels and nutrition data — not medical advice.</p>

          <h2 className="font-semibold text-(--color-fg)">AI search</h2>
          <p>Scout is free for everyone, with unlimited searches whether or not you sign in. Sign in to save searches and manage alerts.</p>

          <h2 className="font-semibold text-(--color-fg)">Disclaimer</h2>
          <p>Product data is sourced from public catalogs and may contain errors. Always check the physical label before consuming, especially for allergens.</p>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
