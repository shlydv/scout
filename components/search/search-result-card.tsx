"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { AddToBasketButton } from "@/components/add-to-basket-button";
import { CompareButton } from "@/components/compare-button";
import { catalogTierStyle } from "@/lib/scoring/verdict-display";
import { VERDICT_LABELS } from "@/lib/scoring/verdict";
import { rankShort } from "@/lib/utils";
import type { SearchCard } from "@/lib/search/planned/present";

function priceLabel(card: Pick<SearchCard, "price_inr">) {
  return card.price_inr != null ? `₹${Math.round(card.price_inr * 100) / 100}` : "—";
}

export function SearchResultCard({ card, query, muted = false }: { card: SearchCard; query: string; muted?: boolean }) {
  const [sizesOpen, setSizesOpen] = useState(false);
  const href = `/product/${card.slug}?q=${encodeURIComponent(query)}`;
  const tier = card.score != null ? catalogTierStyle(card.score, card.verdict).fill : "var(--color-fg-dim)";
  // Only a genuinely good rank is worth a badge ("#56 in …" reads as noise).
  const rankRaw = card.rank ? rankShort(card.rank.rank, card.rank.size) : null;
  const rank = rankRaw && !rankRaw.startsWith("#") ? rankRaw : null;
  const cheapest = card.sizes.length ? Math.min(...card.sizes.map(s => s.price_inr ?? Infinity)) : null;

  return (
    <article className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-(--color-panel) transition hover:border-(--color-line-strong) hover:shadow-[0_6px_24px_-12px_rgba(0,0,0,0.25)] ${muted ? "border-dashed border-(--color-line-strong) opacity-90" : "border-(--color-line)"}`}>
      <Link href={href} className="relative block aspect-square bg-white">
        {card.image ? (
          <Image src={card.image} alt={card.name} fill sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw" className="object-contain p-4 transition group-hover:scale-[1.03]" />
        ) : (
          <div className="grid h-full place-items-center text-xs text-(--color-fg-dim)">No image</div>
        )}
        {card.score != null && (
          <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
            <span className="grid h-9 min-w-9 place-items-center rounded-lg px-1.5 font-display text-lg font-bold tabular-nums text-white shadow" style={{ backgroundColor: tier }}>
              {card.score}
            </span>
            {card.verdict && (
              <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm" style={{ color: tier }}>
                {VERDICT_LABELS[card.verdict].title}
              </span>
            )}
          </div>
        )}
        {card.fit === "good" && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-(--color-good) px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            <Check className="h-3 w-3" aria-hidden /> Strong fit
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div>
          {card.brand && <p className="truncate text-[11px] font-medium uppercase tracking-wide text-(--color-fg-dim)">{card.brand}</p>}
          <Link href={href} className="line-clamp-2 text-[14px] font-medium leading-snug text-(--color-fg) hover:underline">
            {card.name}
          </Link>
        </div>

        {card.reasons.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {card.reasons.map(r => (
              <li key={r} className="rounded-full bg-(--color-bg-soft) px-2 py-0.5 text-[11px] text-(--color-fg-muted)">{r}</li>
            ))}
          </ul>
        )}

        {card.warning && (
          <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-(--color-warn)">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{card.warning}</span>
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tabular-nums text-(--color-fg)">
              {priceLabel(card)}
              {card.net_weight && <span className="ml-1 text-[12px] font-normal text-(--color-fg-dim)">{card.net_weight}</span>}
            </p>
            {card.sizes.length > 1 ? (
              <button type="button" onClick={() => setSizesOpen(o => !o)} className="text-[11.5px] text-(--color-accent) hover:underline" aria-expanded={sizesOpen}>
                {card.sizes.length} sizes{cheapest != null && Number.isFinite(cheapest) ? ` · from ₹${cheapest}` : ""}
              </button>
            ) : rank ? (
              <p className="text-[11.5px] text-(--color-fg-dim)">{rank}{card.rank?.label ? ` in ${card.rank.label.toLowerCase()}` : ""}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <CompareButton slug={card.slug} name={card.name} image={card.image} />
            <AddToBasketButton slug={card.slug} name={card.name} productId={card.id} size="icon" />
          </div>
        </div>

        {sizesOpen && card.sizes.length > 1 && (
          <ul className="grid gap-1 border-t border-(--color-line) pt-2 text-[12px]">
            {card.sizes.map(s => (
              <li key={s.slug}>
                <Link href={`/product/${s.slug}`} className="flex justify-between gap-2 rounded px-1 py-0.5 hover:bg-(--color-bg-soft)">
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
