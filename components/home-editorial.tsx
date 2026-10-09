import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/reveal";
import type {
  LandingBestInClassCategory,
  LandingDodgeProduct,
} from "@/lib/products/landing-insights";

/**
 * "Today's reckoning" — the betrayal hook. Beloved products whose front-of-pack
 * marketing doesn't survive the back label. Uses the same editorial card layout
 * as "Worth buying every week" so scrolling feels continuous, not jarring.
 */
export function HomeReckoning({ products }: { products: LandingDodgeProduct[] }) {
  const picks = products.slice(0, 10);
  if (picks.length < 2) return null;
  return (
    <section className="border-b border-(--color-line)">
      <Reveal className="mx-auto max-w-7xl px-6 py-16 md:py-24">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-(--color-bad)">
              Today&apos;s reckoning
            </p>
            <h2 className="font-display mt-3 text-3xl leading-tight md:text-[2.5rem]">
              The marketing&apos;s a lie.
            </h2>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-(--color-fg-muted)">
              Front-of-pack says one thing. The back label says another. We read both.
            </p>
          </div>
          <Link
            href="/catalog?verdict=skip&sort=score-asc"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)"
          >
            Full skip list
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {picks.map((p) => (
            <HomeDodgeCard key={p.slug} product={p} />
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function HomeDodgeCard({ product }: { product: LandingDodgeProduct }) {
  const thumb = product.image_urls[0] ?? product.image;
  const price = product.price;

  return (
    <Link
      href={`/product/${product.slug}`}
      className="group flex h-full flex-col"
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl photo-frame shadow-[0_1px_2px_rgba(60,40,20,0.05)] transition duration-300 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_34px_-20px_rgba(60,40,20,0.34)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)] dark:group-hover:shadow-[0_16px_34px_-18px_rgba(0,0,0,0.6)]"
        style={{ borderTop: "2px solid var(--score-bad)" }}
      >
        {thumb ? (
          <Image
            src={thumb}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-(--color-fg-dim)">
            No image
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full border border-(--score-bad) bg-transparent px-2 py-0.5 text-[10px] font-semibold text-(--score-bad) backdrop-blur">
          Skip
        </span>
      </div>

      <div className="mt-2.5 flex flex-1 flex-col">
        {product.brand ? (
          <p className="truncate text-[10px] uppercase tracking-[0.14em] text-(--color-fg-dim)">
            {product.brand}
          </p>
        ) : null}
        <p className="line-clamp-2 mt-0.5 text-[14px] leading-snug text-(--color-fg) group-hover:text-(--color-bad)">
          {product.name}
        </p>
        {price != null ? (
          <p className="mt-1 text-[12px] tabular-nums text-(--color-fg-muted)">
            ₹{price}
          </p>
        ) : null}

        <div className="mt-2.5 space-y-1 border-t border-(--color-line) pt-2 text-[11px] leading-snug">
          <p className="text-(--color-fg-muted)">
            <span className="font-semibold uppercase tracking-wide text-(--color-fg-dim)">Claims </span>
            {product.claim}
          </p>
          <p className="text-(--color-fg)">
            <span className="font-semibold uppercase tracking-wide text-(--score-bad)">Really </span>
            {product.reality}
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * Category grid — the "where do I start?" answer. Each aisle with one damning
 * micro-stat. Scannable, invites exploration, far better than a single product rail.
 */
export function HomeCategoryGrid({ categories }: { categories: LandingBestInClassCategory[] }) {
  const cats = categories.slice(0, 8);
  if (cats.length < 3) return null;
  return (
    <section>
      <Reveal className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <div className="mb-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-(--color-fg-dim)">
            Start somewhere
          </p>
          <h2 className="font-display mt-2 text-3xl leading-tight md:text-[2.5rem]">
            Every aisle, judged.
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cats.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="u-lift group rounded-2xl border border-(--color-line) bg-(--color-panel) p-4 hover:border-(--color-fg-muted)"
            >
              <p className="text-[15px] font-medium text-(--color-fg) group-hover:text-(--color-accent)">
                {c.label}
              </p>
              <p className="mt-2 flex items-center gap-2 text-[12px] tabular-nums text-(--color-fg-dim)">
                <span>
                  avg <span className="font-semibold text-(--color-fg-muted)">{c.avgScore}</span>
                </span>
                <span aria-hidden>·</span>
                <span className="text-(--color-bad)">{c.skipPct}% skip</span>
              </p>
            </Link>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
