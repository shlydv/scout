import type { Metadata } from "next";
import Link from "next/link";
import { ConflictCard } from "@/components/insights/conflict-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { CONFLICT_KIND_LABELS, getInsights } from "@/lib/insights/data";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Pack claims vs ingredient lists · Scout",
  description: "Packaged foods whose own ingredient list contradicts a claim on the pack — sugar free, gluten free, no palm oil and more.",
};

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const d = await getInsights();
  const list = kind ? d.allConflicts.filter(c => c.kind === kind) : d.allConflicts;
  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 md:px-6 md:pt-14">
        <Link href="/insights" className="text-sm text-(--color-fg-muted) hover:text-(--color-fg)">← What we found</Link>
        <h1 className="font-display mt-4 text-4xl leading-tight text-(--color-fg) md:text-5xl">The pack says one thing. The label says another.</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-(--color-fg-muted)">
          Products whose ingredient list contradicts a claim printed on the same pack. Only clear cases are listed — anything debatable (dates as a “natural” sweetener, oats in a gluten-free product) is left out.
        </p>
        <nav className="mt-8 flex flex-wrap gap-2" aria-label="Filter by claim type">
          <Link href="/insights/claims" aria-current={!kind ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${!kind ? "border-(--color-fg) bg-(--color-fg) text-(--color-bg)" : "border-(--color-line) bg-(--color-panel) text-(--color-fg-muted)"}`}>All</Link>
          {d.conflictsByKind.map(k => (
            <Link key={k.kind} href={`/insights/claims?kind=${k.kind}`} aria-current={kind === k.kind ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${kind === k.kind ? "border-(--color-fg) bg-(--color-fg) text-(--color-bg)" : "border-(--color-line) bg-(--color-panel) text-(--color-fg-muted) hover:text-(--color-fg)"}`}>
              {CONFLICT_KIND_LABELS[k.kind] ?? k.kind} <span className="tabular-nums opacity-70">{k.count}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(c => <ConflictCard key={`${c.id}-${c.claim}`} c={c} />)}
        </div>
        {!list.length && <p className="mt-6 text-sm text-(--color-fg-muted)">Nothing in this category.</p>}
      </div>
      <SiteFooter />
    </main>
  );
}
