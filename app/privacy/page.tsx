import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const revalidate = 86400;

export const metadata: Metadata = { title: "Privacy Policy · Scout" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <SiteNav />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-3xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-(--color-fg-muted)">Last updated: October 2026</p>

        <section className="mt-8 space-y-4 text-(--color-fg-muted)">
          <h2 className="font-semibold text-(--color-fg)">What we collect</h2>
          <p>When you sign in, we store your email and search history to improve your experience. We do not sell, share, or monetize your personal data.</p>

          <h2 className="font-semibold text-(--color-fg)">Search data</h2>
          <p>Your queries and product interactions help us rank results better. This data is associated with your account and never shared with third parties.</p>

          <h2 className="font-semibold text-(--color-fg)">Cookies</h2>
          <p>We use a session cookie for authentication. No tracking cookies, no ads.</p>

          <h2 className="font-semibold text-(--color-fg)">Contact</h2>
          <p>Questions? Reach out at sahil27gunwal@gmail.com.</p>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
