import Image from "next/image";
import Link from "@/components/navigation-link";
import { variantKey } from "@/lib/facts/variant-key";
import { catalogTierStyle } from "@/lib/scoring/verdict-display";
import type { SearchCard } from "@/lib/search/planned/present";
import type { Shelf } from "@/lib/shelves";

function metricLabel(card: SearchCard, metric: Shelf["metric"]): string | null {
  const n = card.nutrition;
  if (metric === "protein" && n.protein_g != null) return `${Math.round(n.protein_g)}g protein`;
  if (metric === "sugar" && n.sugar_g != null) return `${Math.round(n.sugar_g * 10) / 10}g sugar`;
  return null;
}

/**
 * The product line a pick belongs to: its name without "(Creamy)"-style variants and without
 * what follows the first "|" ("Whey Isolate | Unflavoured"), unless that leaves only the brand.
 */
function lineKey(p: SearchCard): string {
  const name = p.name.replace(/\([^)]*\)/g, " ");
  const key = variantKey(p.brand, name.split("|")[0]!);
  return key.endsWith("|") ? variantKey(p.brand, name) : key;
}

/**
 * The board's three picks are three different things: variants of one line count once, since
 * their names truncate to the same text. The shelf page still lists them all.
 */
function topPicks(items: SearchCard[]): SearchCard[] {
  const seen = new Set<string>();
  return items.filter(p => {
    const k = lineKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3);
}

/** Leaderboard board for one goal shelf: its title, and its top three picks. */
export function ShelfBoard({ shelf, items, total }: { shelf: Shelf; items: SearchCard[]; total: number }) {
  const href = `/shelves/${shelf.slug}`;
  return (
    <div className="rounded-xl border border-(--color-line) bg-(--color-panel) p-3.5">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={href} className="font-display block text-[1.35rem] leading-tight text-(--color-fg) hover:text-(--color-accent)">{shelf.title}</Link>
          <p className="mt-0.5 text-[11.5px] text-(--color-fg-dim)">{shelf.blurb}</p>
        </div>
        <Link href={href} className="shrink-0 pt-0.5 text-[10.5px] text-(--color-fg-dim) hover:text-(--color-fg)">{total ? `All ${total} →` : "Open →"}</Link>
      </div>
      {items.length > 0 ? (
        <ol className="space-y-1.5">
          {topPicks(items).map((p, i) => {
            const metric = metricLabel(p, shelf.metric);
            // Score, metric, price: whichever exist, dot-separated.
            const meta = [
              p.score != null ? { text: `${p.score}/100`, color: catalogTierStyle(p.score, p.verdict).fill } : null,
              metric ? { text: metric } : null,
              p.price_inr != null ? { text: `₹${Math.round(p.price_inr)}` } : null,
            ].filter(m => m != null);
            return (
              <li key={p.id}>
                <Link href={`/product/${p.slug}`} className="group flex items-center gap-2.5 rounded-lg border border-(--color-line) bg-(--color-bg) p-2 transition hover:border-(--color-fg-dim)">
                  <span className="font-display w-3.5 shrink-0 text-center text-base leading-none text-(--color-fg-dim)">{i + 1}</span>
                  <span className="thumb relative h-8 w-8 shrink-0 overflow-hidden rounded-md">
                    {p.image && <Image src={p.image} alt="" fill sizes="32px" className="object-contain p-0.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-(--color-fg) group-hover:text-(--color-accent)">{p.name}</span>
                    <span className="flex gap-1.5 text-[10px] text-(--color-fg-dim)">
                      {meta.map((m, j) => (
                        <span key={j} className={m.color ? "font-semibold" : undefined} style={m.color ? { color: m.color } : undefined}>{j > 0 && "· "}{m.text}</span>
                      ))}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <Link href={href} className="block rounded-lg border border-dashed border-(--color-line-strong) p-3 text-[11.5px] text-(--color-fg-muted) hover:text-(--color-fg)">
          Being restocked — open the shelf to see today&apos;s picks.
        </Link>
      )}
    </div>
  );
}
