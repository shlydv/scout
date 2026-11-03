import type { Metadata } from "next";
import Link from "@/components/navigation-link";
import { notFound } from "next/navigation";
import { PaperBackdrop } from "@/components/paper-backdrop";
import { SearchResultCard } from "@/components/search/search-result-card";
import { shelfNo } from "@/components/shelf-board";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SHELVES, shelfBySlug, shelfOrderLabel } from "@/lib/shelves";
import { getShelf } from "@/lib/shelves-data";

// Results are cached for a day (lib/shelves-data); the page re-renders hourly.
export const revalidate = 3600;
export const preferredRegion = "sin1";
export const maxDuration = 60;

// No pages at build time; each shelf renders on its first visit, then is cached.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const shelf = shelfBySlug((await params).slug);
  return shelf ? { title: `${shelf.title} · Scout`, description: shelf.note } : { title: "Shelf not found · Scout" };
}

export default async function ShelfPage({ params }: { params: Promise<{ slug: string }> }) {
  const shelf = shelfBySlug((await params).slug);
  if (!shelf) notFound();
  const index = SHELVES.indexOf(shelf);
  const data = await getShelf(shelf.slug);
  const refreshed = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const searchHref = `/search?q=${encodeURIComponent(shelf.query)}`;

  return (
    <main className="relative isolate min-h-screen">
      <PaperBackdrop />
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 md:px-6 md:pt-14">
        <Link href="/shelves" className="text-[13px] text-(--color-fg-dim) hover:text-(--color-fg)">← All shelves</Link>
        <header className="mt-6 max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-accent)">
            Shelf {shelfNo(index)} <span className="text-(--color-fg-dim)">· restocked {refreshed}</span>
          </p>
          <h1 className="font-display mt-2 text-4xl leading-[1.05] text-(--color-fg) md:text-[3.25rem]">{shelf.title}</h1>
          <p className="font-display mt-4 text-[1.3rem] italic leading-snug text-(--color-fg-muted)">{shelf.note}</p>
        </header>

        {data && data.items.length > 0 ? (
          <>
            <div className="mt-10 mb-3 flex items-baseline justify-between gap-3 border-b border-(--color-line) pb-2">
              <p className="text-[12px] text-(--color-fg-dim)"><span className="font-semibold text-(--color-fg)">{data.items.length}</span> on the shelf today, {shelfOrderLabel(shelf)}</p>
              <Link href={searchHref} className="text-[12px] text-(--color-fg-dim) hover:text-(--color-fg)">Tweak this list →</Link>
            </div>
            <ol className="grid-rise grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((card, i) => (
                <li key={card.id} className="grid grid-cols-1 min-w-0"><SearchResultCard card={card} query={shelf.query} position={i + 1} /></li>
              ))}
            </ol>
          </>
        ) : (
          <p className="mt-10 rounded-xl border border-dashed border-(--color-line-strong) p-5 text-sm text-(--color-fg-muted)">
            This shelf is being restocked. <Link href={searchHref} className="text-(--color-accent) hover:underline">Run it as a search</Link> in the meantime.
          </p>
        )}

        <nav className="mt-16 border-t border-(--color-line) pt-8" aria-label="Other shelves">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-fg-dim)">Other shelves</p>
          <ul className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {SHELVES.map((s, i) => s.slug === shelf.slug ? null : (
              <li key={s.slug} className="border-b border-(--color-line)">
                <Link href={`/shelves/${s.slug}`} className="group flex items-baseline gap-3 py-2.5">
                  <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--color-fg-dim)">{shelfNo(i)}</span>
                  <span className="font-display text-[1.15rem] text-(--color-fg) group-hover:text-(--color-accent)">{s.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <SiteFooter />
    </main>
  );
}
