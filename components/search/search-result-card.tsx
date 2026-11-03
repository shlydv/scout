"use client";

import { productHref } from "@/lib/shopping/links";
import Image from "next/image";
import Link from "@/components/navigation-link";
import { useState } from "react";
import { AddToBasketButton } from "@/components/add-to-basket-button";
import { CompareButton } from "@/components/compare-button";
import { LineTag } from "@/components/line-tag";
import { brandSlug } from "@/lib/brands/slug";
import { catalogTierStyle, verdictTitle } from "@/lib/scoring/verdict-display";
import { rankShort } from "@/lib/utils";
import type { SearchCard } from "@/lib/search/planned/present";

function priceLabel(card: Pick<SearchCard, "price_inr">) {
  return card.price_inr != null ? `₹${Math.round(card.price_inr * 100) / 100}` : "—";
}

/**
 * Compact product row-card: thumbnail, name, score, then one or two tagged
 * lines saying why it's here and what to watch. `position` turns it into a
 * leaderboard entry (shelves).
 */
export function SearchResultCard({ card, query, muted = false, position, hideBrand = false }: { card: SearchCard; query: string; muted?: boolean; position?: number; hideBrand?: boolean }) {
  const [sizesOpen, setSizesOpen] = useState(false);
  const href = productHref(card.slug, card.shoppingContext, query);
  const tier = card.score != null ? catalogTierStyle(card.score, card.verdict).fill : "var(--color-fg-dim)";
  // Only a genuinely good rank is worth saying ("#56 in …" reads as noise).
  const rankRaw = card.rank ? rankShort(card.rank.rank, card.rank.size) : null;
  const rank = rankRaw && !rankRaw.startsWith("#") ? rankRaw : null;
  const cheapest = card.sizes.length ? Math.min(...card.sizes.map(s => s.price_inr ?? Infinity)) : null;

  return (
    <article className={`group relative flex min-w-0 flex-col rounded-xl border bg-(--color-panel) p-3 transition hover:border-(--color-fg-dim) ${muted ? "border-dashed border-(--color-line-strong)" : "border-(--color-line)"}`}>
      <div className="flex items-start gap-2.5">
        {position != null && (
          <span className="font-display w-7 shrink-0 pt-0.5 text-[1.6rem] leading-none tabular-nums text-(--color-fg-dim)">{position}</span>
        )}
        <Link href={href} className="thumb relative h-12 w-12 shrink-0 overflow-hidden rounded-lg" tabIndex={-1} aria-hidden>
          {card.image && <Image src={card.image} alt="" fill sizes="48px" className="object-contain p-1" />}
        </Link>
        <div className="min-w-0 flex-1">
          {card.brand && !hideBrand && <Link href={`/brands/${brandSlug(card.brand)}`} className="block truncate text-[9.5px] uppercase tracking-wide text-(--color-fg-dim) hover:text-(--color-fg)">{card.brand}</Link>}
          <Link href={href} className="line-clamp-2 text-[13px] font-medium leading-snug text-(--color-fg) group-hover:text-(--color-accent)">
            {card.name}
          </Link>
        </div>
        {card.score != null && (
          <div className="shrink-0 text-right leading-none">
            <span className="text-lg font-bold tabular-nums" style={{ color: tier }}>{card.score}</span>
            {card.verdict && <span className="mt-1 block text-[9px] font-semibold uppercase tracking-wide" style={{ color: tier }}>{verdictTitle(card.verdict)}</span>}
          </div>
        )}
      </div>

      {(card.reasons.length > 0 || card.warning) && (
        <div className="mt-2.5 space-y-1 text-[11.5px] leading-snug">
          {card.reasons.length > 0 && (
            <p className="flex items-baseline gap-1.5">
              <LineTag tone="good">{card.fit === "good" ? "Fits" : "Label"}</LineTag>
              <span className="text-(--color-fg-muted)">{card.reasons.join(" · ")}</span>
            </p>
          )}
          {card.warning && (
            <p className="flex items-baseline gap-1.5">
              <LineTag tone="bad">Watch</LineTag>
              <span className="text-(--color-fg-muted)">{card.warning}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
        <p className="min-w-0 truncate text-[12.5px] tabular-nums text-(--color-fg-dim)">
          <span className="font-semibold text-(--color-fg)">{priceLabel(card)}</span>
          {card.net_weight && <> · {card.net_weight}</>}
          {card.sizes.length > 1 ? (
            <>
              {" · "}
              <button type="button" onClick={() => setSizesOpen(o => !o)} className="text-(--color-accent) hover:underline" aria-expanded={sizesOpen}>
                {card.sizes.length} sizes{cheapest != null && Number.isFinite(cheapest) ? ` from ₹${cheapest}` : ""}
              </button>
            </>
          ) : rank ? (
            <> · {rank}{card.rank?.label ? ` in ${card.rank.label.toLowerCase()}` : ""}</>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <CompareButton shoppingContext={card.shoppingContext} slug={card.slug} name={card.name} image={card.image} />
          <AddToBasketButton shoppingContext={card.shoppingContext} slug={card.slug} name={card.name} productId={card.id} size="icon" />
        </div>
      </div>

      {sizesOpen && card.sizes.length > 1 && (
        <ul className="mt-2 grid grid-cols-1 gap-0.5 border-t border-dashed border-(--color-line-strong) pt-2 text-[12px]">
          {card.sizes.map(s => (
            <li key={s.slug}>
              <Link href={productHref(s.slug, card.shoppingContext, query)} className="flex justify-between gap-2 rounded px-1 py-0.5 hover:bg-(--color-bg-soft)">
                <span className="text-(--color-fg-muted)">{s.net_weight ?? "—"}</span>
                <span className="tabular-nums text-(--color-fg)">{priceLabel(s)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
