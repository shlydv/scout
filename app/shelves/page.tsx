import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SHELVES } from "@/lib/shelves";

export const metadata: Metadata = {
  title: "Goal shelves · Scout",
  description: "Ready-made shortlists for real goals — high-protein snacks, kids' tiffin, diabetic-friendly breakfast — checked against the back label.",
};

export default function ShelvesPage() {
  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 md:px-6 md:pt-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-(--color-fg-dim)">Goal shelves</p>
        <h1 className="font-display mt-3 max-w-3xl text-4xl leading-tight text-(--color-fg) md:text-5xl">Shortlists for what you&apos;re actually shopping for.</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-(--color-fg-muted)">
          Each shelf is a Scout search kept fresh every day — same label checks, same filters — so you can start from a goal instead of a blank box.
        </p>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SHELVES.map(s => (
            <Link key={s.slug} href={`/shelves/${s.slug}`} className="group flex items-start gap-4 rounded-2xl border border-(--color-line) bg-(--color-panel) p-5 transition hover:border-(--color-line-strong)">
              <span className="text-3xl" aria-hidden>{s.emoji}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-display text-xl text-(--color-fg)">{s.title}<ArrowRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" aria-hidden /></span>
                <span className="mt-1 block text-sm leading-relaxed text-(--color-fg-muted)">{s.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
