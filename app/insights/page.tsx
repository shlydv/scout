import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ConflictCard } from "@/components/insights/conflict-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { CONFLICT_KIND_LABELS, getInsights, type AisleStat } from "@/lib/insights/data";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "What we found · Scout",
  description: "What's really inside India's packaged food — counted from the back labels of every product Scout has read.",
};

function Section({ eyebrow, title, intro, children, action }: { eyebrow: string; title: string; intro?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-t border-(--color-line) py-14 md:py-20">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-(--color-fg-dim)">{eyebrow}</p>
          <h2 className="font-display mt-2 text-3xl leading-tight text-(--color-fg) md:text-4xl">{title}</h2>
          {intro && <p className="mt-3 text-[15px] leading-relaxed text-(--color-fg-muted)">{intro}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AisleBars({ rows, colour, noun }: { rows: AisleStat[]; colour: string; noun: string }) {
  return (
    <ol className="grid gap-2.5">
      {rows.map(r => (
        <li key={r.aisle} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm md:grid-cols-[14rem_1fr_auto]">
          <Link href={`/catalog?subcategory=${encodeURIComponent(r.aisle)}`} className="truncate text-(--color-fg) hover:underline">{r.aisle}</Link>
          <div className="h-2.5 overflow-hidden rounded-full bg-(--color-bg-soft)" role="img" aria-label={`${r.pct}% ${noun}`}>
            <div className="h-full rounded-full" style={{ width: `${r.pct}%`, backgroundColor: colour }} />
          </div>
          <span className="w-24 text-right tabular-nums text-(--color-fg-muted)"><span className="font-semibold text-(--color-fg)">{r.pct}%</span> of {r.total}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function InsightsPage() {
  const d = await getInsights();
  const oneIn = d.conflictedProducts ? Math.round(d.claimers / d.conflictedProducts) : 0;

  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <header className="py-14 md:py-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-(--color-fg-dim)">What we found</p>
          <h1 className="font-display mt-3 max-w-3xl text-balance text-4xl leading-[1.05] text-(--color-fg) md:text-6xl">
            We read the back of {d.total.toLocaleString("en-IN")} packs. Here&apos;s what&apos;s inside.
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-(--color-fg-muted)">
            Every number on this page is a count of ingredient lists and nutrition panels printed on packaged foods sold on India&apos;s quick-commerce apps. No lab tests, no estimates — just the label, read carefully.
          </p>
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-(--color-line) bg-(--color-line) md:grid-cols-3">
            {d.ingredientStats.map(s => (
              <div key={s.concept} className="bg-(--color-panel) p-5 md:p-6">
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <span className="font-display text-4xl text-(--color-fg) md:text-5xl">{s.pct}%</span>
                  <span className="mt-1 block text-sm text-(--color-fg-muted)">of products {s.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <Section
          eyebrow="Front of pack vs back of pack"
          title={oneIn ? `1 in ${oneIn} “free-from” claims doesn’t survive the ingredient list.` : "Claims that don't survive the ingredient list."}
          intro={`${d.claimers.toLocaleString("en-IN")} products make a claim like “sugar free”, “no palm oil” or “gluten free”. For ${d.conflictedProducts}, their own ingredient list says otherwise. Each one below is checked twice: by our label reader and by a second, stricter review that drops anything debatable.`}
          action={<Link href="/insights/claims" className="inline-flex items-center gap-1 text-sm font-medium text-(--color-accent) hover:underline">See all {d.conflictedProducts}<ArrowUpRight className="h-3.5 w-3.5" /></Link>}
        >
          <div className="mb-6 flex flex-wrap gap-2">
            {d.conflictsByKind.slice(0, 8).map(k => (
              <Link key={k.kind} href={`/insights/claims?kind=${k.kind}`} className="rounded-full border border-(--color-line) bg-(--color-panel) px-3 py-1 text-sm text-(--color-fg-muted) hover:border-(--color-line-strong) hover:text-(--color-fg)">
                {CONFLICT_KIND_LABELS[k.kind] ?? k.kind} <span className="tabular-nums text-(--color-fg-dim)">{k.count}</span>
              </Link>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.conflicts.slice(0, 9).map(c => <ConflictCard key={`${c.id}-${c.claim}`} c={c} />)}
          </div>
        </Section>

        <div className="grid gap-x-12 md:grid-cols-2">
          <Section eyebrow="Where sugar hides" title="Added sugar, aisle by aisle" intro="Share of products in each aisle whose ingredient list includes sugar, jaggery, syrups or other added sweeteners.">
            <AisleBars rows={d.sugarByAisle} colour="var(--color-accent)" noun="contain added sugar" />
          </Section>
          <Section eyebrow="Palm oil" title="Where palm oil turns up most" intro="Share of products in each aisle that list palm oil or palmolein.">
            <AisleBars rows={d.palmByAisle} colour="var(--score-poor)" noun="contain palm oil" />
          </Section>
        </div>

        <Section eyebrow="The good news" title="The best thing in every big aisle" intro="The highest-scoring product in each of the largest aisles — a good place to start your next basket." action={<Link href="/shelves" className="inline-flex items-center gap-1 text-sm font-medium text-(--color-accent) hover:underline">Browse goal shelves<ArrowUpRight className="h-3.5 w-3.5" /></Link>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {d.bestByAisle.map(b => (
              <Link key={b.aisle} href={`/product/${b.best.slug}`} className="group overflow-hidden rounded-2xl border border-(--color-line) bg-(--color-panel) hover:border-(--color-line-strong)">
                <div className="relative aspect-square bg-white">
                  {b.best.image && <Image src={b.best.image} alt={b.best.name} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-contain p-4" />}
                  {b.best.score != null && <span className="absolute left-2.5 top-2.5 rounded-lg bg-(--score-excellent) px-2 py-1 font-display text-base font-bold text-white">{b.best.score}</span>}
                </div>
                <div className="p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-fg-dim)">Best of {b.total} in {b.aisle}</p>
                  <p className="mt-1 line-clamp-2 text-sm font-medium text-(--color-fg) group-hover:underline">{b.best.name}</p>
                </div>
              </Link>
            ))}
          </div>
        </Section>

        <p className="border-t border-(--color-line) py-10 text-sm text-(--color-fg-dim)">
          How we count: products are read from their pack images and ingredient lists, then each ingredient is mapped to plain concepts (added sugar, palm oil, maida…) with the source line kept as evidence. Labels that are incomplete or unreadable are left out of percentages rather than guessed. Spot a mistake? Tell us from any product page.
        </p>
      </div>
      <SiteFooter />
    </main>
  );
}
