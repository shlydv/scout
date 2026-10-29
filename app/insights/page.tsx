import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/components/navigation-link";
import { ArrowUpRight } from "lucide-react";
import { ConflictCard } from "@/components/insights/conflict-card";
import { RingGlyph } from "@/components/ring-motif";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { CONFLICT_KIND_LABELS, getInsights, type AisleStat } from "@/lib/insights/data";
import { PaperBackdrop } from "@/components/paper-backdrop";

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
    <ol className="grid grid-cols-1 gap-2.5">
      {rows.map(r => (
        <li key={r.aisle} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm md:grid-cols-[14rem_1fr_auto]">
          <Link href={`/catalog?subcategory=${encodeURIComponent(r.aisle)}`} className="truncate text-(--color-fg) hover:underline">{r.aisle}</Link>
          <div className="h-2 overflow-hidden rounded-full bg-(--color-line)" role="img" aria-label={`${r.pct}% ${noun}`}>
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
    <main className="relative isolate min-h-screen">
      <PaperBackdrop />
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <header className="relative py-14 md:py-20">
          <RingGlyph className="absolute -right-24 -top-10 hidden h-[420px] w-[420px] opacity-70 md:block" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-(--color-fg-dim)">What we found</p>
          <h1 className="font-display mt-3 max-w-3xl text-balance text-4xl leading-[1.05] text-(--color-fg) md:text-6xl">
            We read the back of {d.total.toLocaleString("en-IN")}{" "}packs. Here&apos;s what&apos;s inside.
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-(--color-fg-muted)">
            Every number on this page is a count of ingredient lists and nutrition panels printed on packaged foods sold on India&apos;s quick-commerce apps. No lab tests, no estimates — just the label, read carefully.
          </p>
          <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-8 md:grid-cols-3">
            {d.ingredientStats.map(s => (
              <div key={s.concept} className="border-t border-(--color-line-strong) pt-4">
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <span className="font-display text-5xl leading-none text-(--color-accent) md:text-6xl">{s.pct}%</span>
                  <span className="mt-2 block text-[13.5px] text-(--color-fg-muted)">of packaged foods {s.label}</span>
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
              <Link key={k.kind} href={`/insights/claims?kind=${k.kind}`} className="rounded-full border border-(--color-line) px-3 py-1 text-[12.5px] text-(--color-fg-muted) hover:border-(--color-fg-dim) hover:text-(--color-fg)">
                {CONFLICT_KIND_LABELS[k.kind] ?? k.kind} <span className="tabular-nums text-(--color-fg-dim)">{k.count}</span>
              </Link>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.conflicts.slice(0, 9).map(c => <ConflictCard key={`${c.id}-${c.claim}`} c={c} />)}
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-x-12 md:grid-cols-2">
          <Section eyebrow="Where sugar hides" title="Added sugar, aisle by aisle" intro="Share of products in each aisle whose ingredient list includes sugar, jaggery, syrups or other added sweeteners.">
            <AisleBars rows={d.sugarByAisle} colour="var(--color-accent)" noun="contain added sugar" />
          </Section>
          <Section eyebrow="Palm oil" title="Where palm oil turns up most" intro="Share of products in each aisle that list palm oil or palmolein.">
            <AisleBars rows={d.palmByAisle} colour="var(--score-poor)" noun="contain palm oil" />
          </Section>
        </div>

        <Section eyebrow="The good news" title="The best thing in every big aisle" intro="The highest-scoring product in each of the largest aisles — a good place to start your next basket." action={<Link href="/shelves" className="inline-flex items-center gap-1 text-sm font-medium text-(--color-accent) hover:underline">Browse goal shelves<ArrowUpRight className="h-3.5 w-3.5" /></Link>}>
          <ol className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
            {d.bestByAisle.map((b, i) => (
              <li key={b.aisle} className="border-b border-(--color-line)">
                <Link href={`/product/${b.best.slug}`} className="group flex items-center gap-3 py-3">
                  <span className="font-display w-6 shrink-0 text-xl leading-none tabular-nums text-(--color-fg-dim)">{i + 1}</span>
                  <span className="thumb relative h-11 w-11 shrink-0 overflow-hidden rounded-lg">
                    {b.best.image && <Image src={b.best.image} alt="" fill sizes="44px" className="object-contain p-1" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-(--color-fg-dim)">{b.aisle} · best of {b.total}</span>
                    <span className="block truncate text-[13.5px] font-medium text-(--color-fg) group-hover:text-(--color-accent)">{b.best.name}</span>
                  </span>
                  {b.best.score != null && <span className="shrink-0 text-lg font-bold tabular-nums text-(--score-excellent)">{b.best.score}</span>}
                </Link>
              </li>
            ))}
          </ol>
        </Section>

        <p className="border-t border-(--color-line) py-10 text-sm text-(--color-fg-dim)">
          How we count: products are read from their pack images and ingredient lists, then each ingredient is mapped to plain concepts (added sugar, palm oil, maida…) with the source line kept as evidence. Labels that are incomplete or unreadable are left out of percentages rather than guessed. Spot a mistake? Tell us from any product page.
        </p>
      </div>
      <SiteFooter />
    </main>
  );
}
