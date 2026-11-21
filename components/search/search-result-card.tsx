"use client";

import { productHref } from "@/lib/shopping/links";
import Image from "next/image";
import Link from "@/components/navigation-link";
import { useState } from "react";
import { AddToBasketButton } from "@/components/add-to-basket-button";
import { CompareButton } from "@/components/compare-button";
import { LineTag } from "@/components/line-tag";
import { catalogTierStyle, verdictTitle } from "@/lib/scoring/verdict-display";
import { rankShort } from "@/lib/utils";
import type { SearchCard } from "@/lib/search/planned/present";

function priceLabel(card: Pick<SearchCard, "price_inr">) {
  return card.price_inr != null ? `₹${Math.round(card.price_inr * 100) / 100}` : "—";
}

/**
 * Product tile: photo on top, then a strip in the verdict's colour with the score,
 * then the name, pack size or rank, and one or two tagged lines saying why it's here
 * and what to watch. `position` turns it into a leaderboard entry (shelves).
 */
export function SearchResultCard({ card, query, muted = false, position }: { card: SearchCard; query: string; muted?: boolean; position?: number }) {
  const [sizesOpen, setSizesOpen] = useState(false);
  const href = productHref(card.slug, card.shoppingContext, query);
  const tier = card.score != null ? catalogTierStyle(card.score, card.verdict).fill : "var(--color-fg-dim)";
  // Only a genuinely good rank is worth saying ("#56 in …" reads as noise).
  const rankRaw = card.rank ? rankShort(card.rank.rank, card.rank.size) : null;
  const rank = rankRaw && !rankRaw.startsWith("#") ? rankRaw : null;
  const cheapest = card.sizes.length ? Math.min(...card.sizes.map(s => s.price_inr ?? Infinity)) : null;
  const meta = card.net_weight || card.sizes.length > 1 || rank;

  return (
    <article className={`group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-(--color-panel) transition hover:border-(--color-fg-dim) ${muted ? "border-dashed border-(--color-line-strong)" : "border-(--color-line)"}`}>
      <Link href={href} className="tile-photo relative block h-36 sm:h-44" tabIndex={-1} aria-hidden>
        {card.image && <Image src={card.image} alt="" fill sizes="(min-width: 1024px) 270px, (min-width: 640px) 33vw, 50vw" className="object-contain p-2 sm:p-2.5" />}
      </Link>

      <div className="flex items-baseline gap-1.5 px-2.5 py-1.5 sm:px-3" style={{ background: `color-mix(in srgb, ${tier} 12%, var(--color-panel))`, color: tier }}>
        {card.score != null ? (
          <>
            <span className="text-[17px] font-bold leading-none tabular-nums">{card.score}</span>
            {card.verdict && <span className="truncate text-[9px] font-semibold uppercase leading-none tracking-wide">{verdictTitle(card.verdict)}</span>}
          </>
        ) : (
          <span className="text-[11px] font-medium leading-[17px]">Score pending</span>
        )}
        {position != null && (
          <span className="font-display ml-auto shrink-0 text-[1.15rem] leading-none tabular-nums text-(--color-fg-dim)">#{position}</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-2.5 pb-2.5 pt-2 sm:px-3 sm:pb-3">
        <Link href={href} className="line-clamp-3 text-[12.5px] font-medium leading-snug text-(--color-fg) group-hover:text-(--color-accent) sm:text-[13px]">
          {card.name}
        </Link>

        {meta && (
          <p className="line-clamp-2 text-[11px] leading-snug tabular-nums text-(--color-fg-dim) sm:text-[11.5px]">
            {card.net_weight}
            {card.sizes.length > 1 ? (
              <>
                {card.net_weight && " · "}
                <button type="button" onClick={() => setSizesOpen(o => !o)} className="text-(--color-accent) hover:underline" aria-expanded={sizesOpen}>
                  {card.sizes.length} sizes{cheapest != null && Number.isFinite(cheapest) ? ` from ₹${cheapest}` : ""}
                </button>
              </>
            ) : rank ? (
              <>{card.net_weight && " · "}{rank}{card.rank?.label ? ` in ${card.rank.label.toLowerCase()}` : ""}</>
            ) : null}
          </p>
        )}

        {(card.reasons.length > 0 || card.warning) && (
          <div className="space-y-1 text-[11px] leading-snug sm:text-[11.5px]">
            {card.reasons.length > 0 && (
              <p className="flex items-baseline gap-1.5">
                <LineTag tone="good">{card.fit === "good" ? "Fits" : "Label"}</LineTag>
                <span className="line-clamp-2 text-(--color-fg-muted)">{card.reasons.join(" · ")}</span>
              </p>
            )}
            {card.warning && (
              <p className="flex items-baseline gap-1.5">
                <LineTag tone="bad">Watch</LineTag>
                <span className="line-clamp-2 text-(--color-fg-muted)">{card.warning}</span>
              </p>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <p className="min-w-0 truncate text-[14px] font-semibold tabular-nums text-(--color-fg)">{priceLabel(card)}</p>
          <div className="flex shrink-0 items-center gap-1">
            <CompareButton shoppingContext={card.shoppingContext} slug={card.slug} name={card.name} image={card.image} />
            <AddToBasketButton shoppingContext={card.shoppingContext} slug={card.slug} name={card.name} productId={card.id} size="icon" />
          </div>
        </div>

        {sizesOpen && card.sizes.length > 1 && (
          <ul className="grid grid-cols-1 gap-0.5 border-t border-dashed border-(--color-line-strong) pt-2 text-[12px]">
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
      </div>
    </article>
  );
}
