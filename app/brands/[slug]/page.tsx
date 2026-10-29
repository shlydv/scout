import type { Metadata } from "next";
import Link from "@/components/navigation-link";
import { notFound } from "next/navigation";
import { ConflictCard } from "@/components/insights/conflict-card";
import { PaperBackdrop } from "@/components/paper-backdrop";
import { SearchResultCard } from "@/components/search/search-result-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { getBrand } from "@/lib/brands/data";

export const revalidate = 86400;

// Rendered on first visit, then cached for a day.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const brand = await getBrand((await params).slug).catch(() => null);
  if (!brand) return { title: "Brand not found · Scout" };
  return {
    title: `${brand.name}, read from the back · Scout`,
    description: `${brand.products} ${brand.name} products scored from their labels — average ${brand.avgScore ?? "—"}/100, ${brand.skipPct}% worth skipping${brand.conflicts ? `, ${brand.conflicts} pack claims that don't match the label` : ""}.`,
  };
}

const AISLE_PREVIEW = 6;

function Heading({ eyebrow, tone, title }: { eyebrow: string; tone: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: tone }}>{eyebrow}</p>
      <h2 className="font-display mt-1 text-2xl leading-snug text-(--color-fg) md:text-[1.65rem]">{title}</h2>
    </div>
  );
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const brand = await getBrand((await params).slug);
  if (!brand) notFound();

  const stats = [
    { value: brand.avgScore ?? "—", label: "average Scout score" },
    { value: `${brand.stapleOrGoodPct}%`, label: "are a daily staple or good choice" },
    { value: `${brand.skipPct}%`, label: "are worth skipping" },
    { value: brand.conflicts, label: brand.conflicts === 1 ? "pack claim the label contradicts" : "pack claims the label contradicts" },
  ];

  return (
    <main className="relative isolate min-h-screen">
      <PaperBackdrop />
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 md:px-6 md:pt-14">
        <Link href="/brands" className="text-[13px] text-(--color-fg-dim) hover:text-(--color-fg)">← All brands</Link>
        <header className="mt-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-accent)">
            Brand <span className="text-(--color-fg-dim)">· {brand.products} product{brand.products === 1 ? "" : "s"} read</span>
          </p>
          <h1 className="font-display mt-2 text-4xl leading-[1.05] text-(--color-fg) md:text-[3.25rem]">{brand.name}</h1>
          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
            {stats.map(s => (
              <div key={s.label} className="border-t border-(--color-line-strong) pt-3">
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <span className="font-display text-4xl leading-none text-(--color-accent)">{s.value}</span>
                  <span className="mt-1.5 block text-[12.5px] text-(--color-fg-muted)">{s.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </header>

        {brand.conflictCards.length > 0 && (
          <section className="mt-14">
            <Heading eyebrow="Scout warning" tone="var(--color-bad)" title="What the pack says vs the label." />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {brand.conflictCards.map(c => <ConflictCard key={`${c.id}-${c.claim}`} c={c} />)}
            </div>
          </section>
        )}

        {brand.best.length > 0 && (
          <section className="mt-14">
            <Heading eyebrow="Their best" tone="var(--color-good)" title={`What to buy from ${brand.name}.`} />
            <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {brand.best.map((card, i) => <li key={card.id} className="grid min-w-0 grid-cols-1"><SearchResultCard card={card} query="" position={i + 1} hideBrand /></li>)}
            </ol>
          </section>
        )}

        {brand.worst.length > 0 && (
          <section className="mt-14">
            <Heading eyebrow="Their worst" tone="var(--color-bad)" title="Leave these on the shelf." />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {brand.worst.map(card => <SearchResultCard key={card.id} card={card} query="" hideBrand />)}
            </div>
          </section>
        )}

        <section className="mt-16">
          <Heading eyebrow="Everything" tone="var(--color-fg-dim)" title="Aisle by aisle, best first." />
          <div className="space-y-8">
            {brand.aisles.map(a => (
              <div key={a.aisle}>
                <p className="mb-2.5 flex items-baseline justify-between border-b border-(--color-line) pb-1.5">
                  <span className="text-[13px] font-semibold text-(--color-fg)">{a.aisle}</span>
                  <span className="text-[11px] text-(--color-fg-dim)">{a.items.length}</span>
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {a.items.slice(0, AISLE_PREVIEW).map(card => <SearchResultCard key={card.id} card={card} query="" hideBrand />)}
                </div>
                {a.items.length > AISLE_PREVIEW && (
                  <details className="group mt-3">
                    <summary className="cursor-pointer list-none text-[12px] text-(--color-accent) hover:underline">
                      <span className="group-open:hidden">Show {a.items.length - AISLE_PREVIEW} more</span>
                      <span className="hidden group-open:inline">Show fewer</span>
                    </summary>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {a.items.slice(AISLE_PREVIEW).map(card => <SearchResultCard key={card.id} card={card} query="" hideBrand />)}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
