import Image from "next/image";
import Link from "next/link";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import { VERDICT_COLORS, verdictTitle as titleForVerdict } from "@/lib/scoring/verdict-display";
import { catalogCardDisplayName } from "@/lib/products/card-display-name";
import { displayPriceInr } from "@/lib/products/display-price";
import type { ProductListItem } from "@/lib/products/queries";

/**
 * Editorial rail card — image, brand, name, verdict chip, price.
 * Server component (no client JS). Used on homepage rails.
 */
export function HomeRailCard({ product }: { product: ProductListItem }) {
  const core = product.core_scores;
  const verdict = core
    ? resolveProductVerdict({
        verdict: core.verdict,
        score: core.score,
        name: product.name,
        category: product.category,
        subcategory: product.subcategory,
      })
    : null;
  const c = verdict ? VERDICT_COLORS[verdict] : null;
  const verdictTitle = verdict ? titleForVerdict(verdict) : null;
  const price = displayPriceInr(product);
  const name = catalogCardDisplayName(product.name);
  const thumb = product.image_urls[0];

  return (
    <Link
      href={`/product/${product.slug}`}
      className="group flex h-full flex-col"
    >
      <div
        className="relative aspect-square overflow-hidden rounded-2xl photo-frame transition-transform duration-300 ease-out group-hover:-translate-y-0.5"
        style={c ? { borderTop: `2px solid ${c.chipBorder}` } : undefined}
      >
        {thumb ? (
          <Image
            src={thumb}
            alt={name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-(--color-fg-dim)">
            No image
          </div>
        )}
        {verdictTitle && c ? (
          <span
            className="absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur"
            style={{
              backgroundColor: c.bg,
              color: c.fg,
              borderColor: c.border,
            }}
          >
            {verdictTitle}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex-1">
        {product.brand ? (
          <p className="truncate text-[10px] uppercase tracking-[0.14em] text-(--color-fg-dim)">
            {product.brand}
          </p>
        ) : null}
        <p className="line-clamp-2 mt-0.5 text-[14px] leading-snug text-(--color-fg) group-hover:text-(--color-accent)">
          {name}
        </p>
        {price != null ? (
          <p className="mt-1 text-[12px] tabular-nums text-(--color-fg-muted)">
            ₹{price}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
