"use client";

import Image from "next/image";
import Link from "@/components/navigation-link";
import { useEffect, useRef, useState } from "react";

type TopItem = {
  id: string;
  name: string;
  brand: string | null;
  slug: string;
  score: number;
  absolute_score: number;
  image_url: string | null;
};

/**
 * Hoverable "Best in {subcategory}" chip — fetches top N in cohort on hover.
 * Shows a popover with rank, brand, name, and score for each.
 */
export function BestInCohortChip({
  cohortId,
  subcategoryLabel,
  productId,
  rank,
  borderColor,
  fgColor,
  labelOverride,
}: {
  cohortId: string;
  subcategoryLabel: string;
  productId: string;
  rank?: number;
  borderColor: string;
  fgColor: string;
  labelOverride?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TopItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const closeTimer = useRef<number | null>(null);

  async function load() {
    if (items || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/cohort/top?id=${encodeURIComponent(cohortId)}&limit=10`);
      if (res.ok) {
        const json = (await res.json()) as { items: TopItem[] };
        setItems(json.items);
      }
    } finally {
      setLoading(false);
    }
  }

  function show() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
    void load();
  }

  function scheduleHide() {
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  }

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const label = labelOverride ?? (subcategoryLabel ? `Best in ${subcategoryLabel}` : "Best in category");

  return (
    <span
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
    >
      <button
        type="button"
        className="cursor-help rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-tight"
        style={{ borderColor, color: fgColor }}
      >
        {label}
      </button>

      {open ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-80 rounded-xl border border-(--color-line) bg-(--color-panel) p-3 shadow-2xl"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <div className="mb-2 flex items-center justify-between border-b border-(--color-line) pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-fg-dim)">
              Top in {subcategoryLabel || "category"}
            </p>
            {rank ? (
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                style={{ borderColor, color: fgColor }}
              >
                You: #{rank}
              </span>
            ) : null}
          </div>

          {loading && !items ? (
            <p className="py-4 text-center text-xs text-(--color-fg-dim)">Loading top picks…</p>
          ) : items?.length ? (
            <ol className="space-y-1.5">
              {items.map((p, i) => {
                const isSelf = p.id === productId;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/product/${p.slug}`}
                      className={`flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-(--color-bg-soft) ${isSelf ? "bg-(--color-bg-soft)" : ""}`}
                    >
                      <span className="w-5 shrink-0 text-right text-[11px] font-bold tabular-nums text-(--color-fg-dim)">
                        {i + 1}
                      </span>
                      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded bg-(--color-bg-soft)">
                        {p.image_url ? (
                          <Image
                            src={p.image_url}
                            alt=""
                            fill
                            sizes="28px"
                            className="object-contain"
                          />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        {p.brand ? (
                          <span className="block truncate text-[9px] uppercase tracking-wider text-(--color-fg-dim)">
                            {p.brand}
                          </span>
                        ) : null}
                        <span className="block truncate text-[12px] text-(--color-fg)">{p.name}</span>
                      </span>
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                        style={{ borderColor, color: fgColor, border: `1px solid ${borderColor}` }}
                      >
                        {p.score}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="py-4 text-center text-xs text-(--color-fg-dim)">No data</p>
          )}
        </div>
      ) : null}
    </span>
  );
}
