import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SearchResultCard } from "@/components/search/search-result-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { plannedSearch } from "@/lib/search/planned/search";
import { presentSearch, type SearchResponse } from "@/lib/search/planned/present";
import { SHELVES, shelfBySlug } from "@/lib/shelves";

// Regenerated at most once a day; rendered on first visit (no LLM calls at build time).
export const revalidate = 86400;
export const preferredRegion = "sin1";
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const shelf = shelfBySlug((await params).slug);
  return shelf ? { title: `${shelf.title} · Scout`, description: shelf.blurb } : { title: "Shelf not found · Scout" };
}

export default async function ShelfPage({ params }: { params: Promise<{ slug: string }> }) {
  const shelf = shelfBySlug((await params).slug);
  if (!shelf) notFound();
  let data: SearchResponse | null = null;
  try {
    data = presentSearch(await plannedSearch(shelf.query, { limit: 24 }));
  } catch (e) {
    console.error("[shelf]", shelf.slug, e instanceof Error ? e.message : e);
  }
  const others = SHELVES.filter(s => s.slug !== shelf.slug).slice(0, 4);

  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-10 md:px-6 md:pt-14">
        <Link href="/shelves" className="text-sm text-(--color-fg-muted) hover:text-(--color-fg)">← All shelves</Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="font-display text-4xl leading-tight text-(--color-fg) md:text-5xl"><span aria-hidden>{shelf.emoji} </span>{shelf.title}</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-(--color-fg-muted)">{shelf.blurb}</p>
          </div>
          <Link href={`/search?q=${encodeURIComponent(shelf.query)}`} className="text-sm font-medium text-(--color-accent) hover:underline">Refine this search →</Link>
        </div>
        {data?.chips.length ? (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {data.chips.map(c => <span key={c} className="rounded-full border border-(--color-line) bg-(--color-panel) px-2.5 py-0.5 text-xs font-medium text-(--color-fg-muted)">{c}</span>)}
          </div>
        ) : null}
        {data && data.items.length > 0 ? (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map(card => <SearchResultCard key={card.id} card={card} query={shelf.query} />)}
          </div>
        ) : (
          <p className="mt-8 rounded-2xl border border-(--color-line) bg-(--color-panel) p-6 text-sm text-(--color-fg-muted)">
            This shelf is refreshing — <Link href={`/search?q=${encodeURIComponent(shelf.query)}`} className="text-(--color-accent) hover:underline">run it as a search</Link> in the meantime.
          </p>
        )}
        <section className="mt-16 border-t border-(--color-line) pt-10">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-(--color-fg-dim)">More shelves</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {others.map(s => (
              <Link key={s.slug} href={`/shelves/${s.slug}`} className="rounded-2xl border border-(--color-line) bg-(--color-panel) p-4 hover:border-(--color-line-strong)">
                <span className="text-xl" aria-hidden>{s.emoji}</span>
                <span className="mt-1 block font-medium text-(--color-fg)">{s.title}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
