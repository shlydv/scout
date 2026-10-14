import type { Metadata } from "next";
import Link from "next/link";
import { PaperBackdrop } from "@/components/paper-backdrop";
import { Reveal } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { RANKED_MIN_PRODUCTS, getBrandIndex, type BrandSummary } from "@/lib/brands/data";
import { catalogTierStyle } from "@/lib/scoring/verdict-display";

const tone = (score: number | null) => (score == null ? "var(--color-fg-dim)" : catalogTierStyle(score, null).fill);

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Brands, read from the back · Scout",
  description: "Every packaged-food brand on India's quick-commerce shelves, ranked by the average Scout score of what they sell.",
};

function Board({ title, eyebrow, accent, brands }: { title: string; eyebrow: string; accent: string; brands: BrandSummary[] }) {
  return (
    <div className="rounded-xl border border-(--color-line) bg-(--color-panel) p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: accent }}>{eyebrow}</p>
      <h2 className="font-display mt-0.5 text-[1.5rem] leading-tight text-(--color-fg)">{title}</h2>
      <ol className="mt-3 space-y-1.5">
        {brands.map((b, i) => (
          <li key={b.slug}>
            <Link href={`/brands/${b.slug}`} className="group flex items-center gap-3 rounded-lg border border-(--color-line) bg-(--color-bg) px-2.5 py-2 transition hover:border-(--color-fg-dim)">
              <span className="font-display w-5 shrink-0 text-center text-base leading-none text-(--color-fg-dim)">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-(--color-fg) group-hover:text-(--color-accent)">{b.name}</span>
                <span className="block text-[10.5px] text-(--color-fg-dim)">{b.products} products · {b.skipPct}% skip{b.conflicts ? ` · ${b.conflicts} claim${b.conflicts === 1 ? "" : "s"} caught` : ""}</span>
              </span>
              <span className="shrink-0 text-lg font-bold tabular-nums" style={{ color: tone(b.avgScore) }}>{b.avgScore}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function BrandsPage() {
  const brands = await getBrandIndex();
  const ranked = brands.filter(b => b.products >= RANKED_MIN_PRODUCTS && b.avgScore != null).sort((a, b) => b.avgScore! - a.avgScore!);
  const listed = brands.filter(b => b.products >= 3).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const byLetter = new Map<string, BrandSummary[]>();
  for (const b of listed) {
    const ch = b.name[0]!.toUpperCase();
    const letter = /[A-Z]/.test(ch) ? ch : "#";
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), b]);
  }

  return (
    <main className="relative isolate min-h-screen">
      <PaperBackdrop />
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 md:px-6 md:pt-14">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-fg-dim)">Brands · {brands.length.toLocaleString("en-IN")} read</p>
        <h1 className="font-display mt-2 max-w-3xl text-4xl leading-[1.05] text-(--color-fg) md:text-[3.25rem]">
          Who makes it <span className="italic text-(--color-accent)">matters.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-(--color-fg-muted)">
          Every brand we&apos;ve read, scored by the average of what they sell. Rankings only count brands with {RANKED_MIN_PRODUCTS}{" "}or more products, so one good jar of honey doesn&apos;t top the list.
        </p>

        <Reveal className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Board eyebrow="Reads well" accent="var(--color-good)" title="Brands that score highest" brands={ranked.slice(0, 12)} />
          <Board eyebrow="Read carefully" accent="var(--color-bad)" title="Brands that score lowest" brands={ranked.slice(-12).reverse()} />
        </Reveal>

        <section className="mt-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-fg-dim)">A to Z</p>
          <h2 className="font-display mt-1 text-2xl leading-snug text-(--color-fg) md:text-[1.65rem]">Every brand with three or more products.</h2>
          <nav className="mt-4 flex flex-wrap gap-1" aria-label="Jump to letter">
            {[...byLetter.keys()].map(l => <a key={l} href={`#letter-${l}`} className="grid h-7 w-7 place-items-center rounded-md text-[12px] text-(--color-fg-muted) hover:bg-(--color-bg-soft) hover:text-(--color-fg)">{l}</a>)}
          </nav>
          <div className="mt-6 grid grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {[...byLetter].map(([letter, list]) => (
              <div key={letter} id={`letter-${letter}`} className="mb-6 break-inside-avoid">
                <p className="font-display border-b border-(--color-line-strong) pb-1 text-xl text-(--color-accent)">{letter}</p>
                <ul>
                  {list.map(b => (
                    <li key={b.slug} className="border-b border-(--color-line)">
                      <Link href={`/brands/${b.slug}`} className="group flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
                        <span className="truncate text-(--color-fg) group-hover:text-(--color-accent)">{b.name}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-(--color-fg-dim)">{b.products} · <span style={{ color: tone(b.avgScore) }}>{b.avgScore ?? "—"}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
