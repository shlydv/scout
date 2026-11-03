import Image from "next/image";
import Link from "@/components/navigation-link";
import { ConflictCard } from "@/components/insights/conflict-card";
import { LineTag } from "@/components/line-tag";
import { Reveal } from "@/components/reveal";
import { shelfNo } from "@/components/shelf-board";
import { variantKey } from "@/lib/facts/variant-key";
import { getInsights } from "@/lib/insights/data";
import { getCachedLandingInsights } from "@/lib/products/catalog-cache";
import { SHELVES } from "@/lib/shelves";

const COUNT = 6;

/** One entry per pack-size group (the 200g and 1kg of the same dal are one pick). */
function oneSize<T extends { brand: string | null; name: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter(p => {
    const k = variantKey(p.brand, p.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A different window of a list each day, so a returning visitor sees new picks. */
function todays<T>(list: T[], offset: number): T[] {
  if (list.length <= COUNT) return list;
  const day = Math.floor(Date.now() / 86_400_000) + offset;
  const start = (day * COUNT) % list.length;
  return [...list.slice(start), ...list.slice(0, start)].slice(0, COUNT);
}

function Heading({ eyebrow, tone, title, action }: { eyebrow: string; tone: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: tone }}>{eyebrow}</p>
        <h2 className="font-display mt-1 text-2xl leading-snug text-(--color-fg) md:text-[1.65rem]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

const actionCls = "shrink-0 text-[11px] text-(--color-fg-dim) hover:text-(--color-fg)";

/** What /search shows before you type: the old leaderboards, now on verified data. */
export async function SearchLanding() {
  const [landing, insights] = await Promise.all([
    getCachedLandingInsights().catch(() => null),
    getInsights().catch(() => null),
  ]);
  const aisles = todays((landing?.bestInClass ?? []).map(c => ({ ...c, products: oneSize(c.products) })), 0);
  const conflicts = todays(insights?.conflicts ?? [], 1);
  const worthIt = todays(oneSize(landing?.worthItList ?? []), 2);

  return (
    <div className="space-y-12 pt-2">
      {aisles.length > 0 && (
        <Reveal as="section">
          <Heading eyebrow="Best in class" tone="var(--color-fg-dim)" title="Top pick in every aisle." action={<Link href="/catalog" className={actionCls}>All aisles →</Link>} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {aisles.map(cat => (
              <div key={cat.label} className="rounded-xl border border-(--color-line) bg-(--color-panel) p-3">
                <div className="mb-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-semibold text-(--color-fg)">{cat.label}</p>
                    <p className="flex gap-2 text-[10px] text-(--color-fg-dim)">
                      <span>avg <strong className="text-(--color-fg)">{cat.avgScore}</strong></span>
                      <span className="text-(--color-bad)">· {cat.skipPct}% skip</span>
                    </p>
                  </div>
                  <Link href={cat.href} className="text-[10px] text-(--color-fg-dim) hover:text-(--color-fg)">All →</Link>
                </div>
                <ol className="space-y-1.5">
                  {cat.products.map(p => (
                    <li key={p.slug}>
                      <Link href={`/product/${p.slug}`} className="group flex items-center gap-2.5 rounded-lg border border-(--color-line) bg-(--color-bg) p-2 transition hover:border-(--color-fg-dim)">
                        <span className="thumb relative h-8 w-8 shrink-0 overflow-hidden rounded-md">
                          {p.image && <Image src={p.image} alt="" fill sizes="32px" className="object-contain p-0.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-medium text-(--color-fg) group-hover:text-(--color-accent)">{p.name}</span>
                          <span className="flex gap-1.5 text-[10px] text-(--color-fg-dim)">
                            <span className="font-semibold text-(--color-good)">{p.score}/100</span>
                            {p.protein != null && <span>· {Math.round(p.protein)}g protein</span>}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {conflicts.length > 0 && (
        <Reveal as="section">
          <Heading eyebrow="Scout warning" tone="var(--color-bad)" title="The marketing's a lie." action={<Link href="/insights/claims" className={actionCls}>All {insights?.conflictedProducts} →</Link>} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {conflicts.map(c => <ConflictCard key={`${c.id}-${c.claim}`} c={c} />)}
          </div>
        </Reveal>
      )}

      {worthIt.length > 0 && (
        <Reveal as="section">
          <Heading eyebrow="Scout verified" tone="var(--color-good)" title="The label checks out." action={<Link href="/catalog?verdict=daily_staple" className={actionCls}>Daily staples →</Link>} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {worthIt.map(p => (
              <Link key={p.slug} href={`/product/${p.slug}`} className="u-lift group rounded-xl border border-(--color-good)/20 bg-(--color-panel) p-3 hover:border-(--color-good)/45">
                <div className="flex items-start gap-2.5">
                  <div className="thumb relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                    {p.image && <Image src={p.image} alt="" fill sizes="40px" className="object-contain p-0.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p.brand && <p className="truncate text-[9.5px] uppercase tracking-wide text-(--color-fg-dim)">{p.brand}</p>}
                    <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-(--color-fg) group-hover:text-(--color-accent)">{p.name}</p>
                  </div>
                  <span className="shrink-0 text-base font-bold tabular-nums text-(--color-good)">{p.score}</span>
                </div>
                <div className="mt-2.5 space-y-1 text-[11.5px] leading-snug">
                  <p className="flex items-baseline gap-1.5"><LineTag tone="good">Panel</LineTag><span className="text-(--color-fg-muted)">{p.reason}</span></p>
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      <Reveal as="section">
        <Heading eyebrow="Goal shelves" tone="var(--color-accent)" title="Or start from a shelf." action={<Link href="/shelves" className={actionCls}>All shelves →</Link>} />
        <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {SHELVES.map((s, i) => (
            <li key={s.slug} className="border-b border-(--color-line)">
              <Link href={`/shelves/${s.slug}`} className="group flex items-baseline gap-3 py-2.5">
                <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--color-fg-dim)">{shelfNo(i)}</span>
                <span className="min-w-0">
                  <span className="font-display block text-[1.15rem] leading-tight text-(--color-fg) group-hover:text-(--color-accent)">{s.title}</span>
                  <span className="block truncate text-[11.5px] text-(--color-fg-dim)">{s.blurb}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
