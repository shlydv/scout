"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeftRight, ChevronDown, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DietPicker } from "@/components/diet-picker";
import { GoalModePicker } from "@/components/goal-mode-picker";
import { readStoredGoal, writeStoredGoal } from "@/lib/goals/storage";
import { readDietMode, writeDietMode } from "@/lib/diet/storage";
import { computeGoalFit, goalFitInputs } from "@/lib/goals/fit";
import type { GoalId } from "@/lib/goals/types";
import type { DietMode } from "@/lib/diet/types";
import { analyzeBasket, computeSwapImpact } from "@/lib/products/basket-analysis";
import { BasketHealthReport } from "@/components/basket-health-report";
import type { SwapSuggestion } from "@/lib/products/alternatives";
import { scoreTileSurface } from "@/lib/score/surfaces";
import {
  addToBasket,
  clearBasket,
  decrementBasket,
  readBasket,
  removeFromBasket,
  replaceInBasket,
} from "@/lib/basket/storage";
import type { ProductListItem } from "@/lib/products/queries";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

export function BasketView() {
  const [entries, setEntries] = useState<ReturnType<typeof readBasket>>([]);
  const [catalog, setCatalog] = useState<ProductListItem[]>([]);
  const [swapsBySlug, setSwapsBySlug] = useState<Record<string, SwapSuggestion[]>>({});
  const [swapsLoading, setSwapsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [goal, setGoal] = useState<GoalId>("balanced");
  const [diet, setDiet] = useState<DietMode>("any");

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const next = readBasket();
      setEntries(next);
      const slugs = [...new Set(next.map((e) => e.slug))];
      if (!slugs.length) {
        if (!cancelled) {
          setCatalog([]);
          setSwapsBySlug({});
          setFetchFailed(false);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setFetchFailed(false);
      try {
        const res = await fetch(`/api/products?slugs=${slugs.map(encodeURIComponent).join(",")}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = (await res.json()) as ProductListItem[];
        if (!cancelled) setCatalog(data);
      } catch {
        if (!cancelled) {
          setCatalog([]);
          setFetchFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const syncGoal = () => {
      setGoal(readStoredGoal());
      setDiet(readDietMode());
    };
    syncGoal();
    sync();
    window.addEventListener("scout-basket", sync);
    window.addEventListener("scout-goal", syncGoal);
    window.addEventListener("scout-diet", syncGoal);
    return () => {
      cancelled = true;
      window.removeEventListener("scout-basket", sync);
      window.removeEventListener("scout-goal", syncGoal);
      window.removeEventListener("scout-diet", syncGoal);
    };
  }, []);

  const pickGoal = (next: GoalId) => {
    writeStoredGoal(next);
    setGoal(next);
  };

  const pickDiet = (next: DietMode) => {
    writeDietMode(next);
    setDiet(next);
  };

  const slugsKey = useMemo(
    () => [...new Set(entries.map((e) => e.slug))].sort().join(","),
    [entries],
  );

  useEffect(() => {
    if (!slugsKey) {
      setSwapsBySlug({});
      return;
    }
    let cancelled = false;
    setSwapsLoading(true);
    const dietQ = diet !== "any" ? `&diet=${diet}` : "";
    fetch(`/api/swaps?slugs=${encodeURIComponent(slugsKey)}&goal=${goal}${dietQ}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { swaps: Record<string, SwapSuggestion[]> }) => {
        if (!cancelled) setSwapsBySlug(data.swaps ?? {});
      })
      .catch(() => {
        if (!cancelled) setSwapsBySlug({});
      })
      .finally(() => {
        if (!cancelled) setSwapsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slugsKey, goal, diet]);

  const lines = useMemo(() => {
    const bySlug = new Map(catalog.map((p) => [p.slug, p]));
    return entries
      .map((e) => {
        const product = bySlug.get(e.slug);
        return product ? { product, qty: e.qty } : null;
      })
      .filter(Boolean) as { product: ProductListItem; qty: number }[];
  }, [entries, catalog]);

  const unresolvedEntries = useMemo(() => {
    const loaded = new Set(catalog.map((p) => p.slug));
    return entries.filter((e) => !loaded.has(e.slug));
  }, [entries, catalog]);

  const analysis = useMemo(() => analyzeBasket(lines, goal), [lines, goal]);
  const swapImpact = useMemo(() => computeSwapImpact(lines, swapsBySlug), [lines, swapsBySlug]);
  const swapCount = Object.values(swapsBySlug).reduce((n, s) => n + s.length, 0);

  if (loading && entries.length > 0) {
    return (
      <div className="rounded-2xl border border-(--color-line) bg-(--color-panel) px-6 py-16 text-center text-sm text-(--color-fg-muted)">
        Loading cart…
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <EmptyCart
        hasStoredItems={entries.length > 0}
        fetchFailed={fetchFailed}
        unresolvedEntries={unresolvedEntries}
      />
    );
  }

  const secondary = analysis.summary.slice(1);

  return (
    <div className="space-y-6">
      {unresolvedEntries.length > 0 ? (
        <div className="rounded-xl border border-(--color-line) bg-(--color-bg-soft) px-4 py-3 text-sm">
          <p className="font-medium text-(--color-fg)">
            {unresolvedEntries.length} item{unresolvedEntries.length === 1 ? "" : "s"} couldn&apos;t
            load
          </p>
          <ul className="mt-2 space-y-1">
            {unresolvedEntries.map((e) => (
              <li key={e.slug} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-(--color-fg-muted)">
                  {e.name}
                  {e.qty > 1 ? ` × ${e.qty}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => removeFromBasket(e.slug)}
                  className="shrink-0 text-xs text-(--color-fg-dim) hover:text-(--color-bad)"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sticky top-16 z-20 -mt-2 flex flex-wrap items-end justify-between gap-3 border-b border-(--color-line) bg-(--color-bg)/85 py-3 backdrop-blur-md">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-(--color-fg-dim)">
            Estimated total
          </p>
          <p className="font-display text-2xl tabular-nums leading-tight text-(--color-fg)">
            {analysis.totalInr > 0 ? `₹${analysis.totalInr}` : "—"}
          </p>
        </div>
        <p className="text-sm text-(--color-fg-muted)">
          {analysis.itemCount} item{analysis.itemCount === 1 ? "" : "s"}
          {swapsLoading
            ? " · finding swaps…"
            : swapCount > 0
              ? ` · ${swapCount} swap${swapCount === 1 ? "" : "s"}`
              : ""}
        </p>
      </div>

      <BasketHealthReport analysis={analysis} impact={swapImpact} swapsLoading={swapsLoading} />

      <div className="space-y-2">
        <GoalModePicker value={goal} onChange={pickGoal} compact />
        <DietPicker value={diet} onChange={pickDiet} compact />
      </div>

      <ul className="divide-y divide-(--color-line) rounded-2xl border border-(--color-line) bg-(--color-panel)">
        {lines.map(({ product, qty }) => (
          <CartLine
            key={product.id}
            product={product}
            qty={qty}
            fit={
              goal === "balanced"
                ? null
                : computeGoalFit(goal, goalFitInputs(product))
            }
            swaps={swapsBySlug[product.slug] ?? []}
          />
        ))}
      </ul>

      <div className="panel-soft rounded-2xl p-4 sm:p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-fg-dim)">
          Cart breakdown
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MetricBar label="Protein share" value={analysis.proteinPct} max={40} tone="good" />
          <MetricBar
            label="Avg sugar / 100g"
            value={analysis.avgSugarG}
            max={25}
            tone={analysis.avgSugarG != null && analysis.avgSugarG > 12 ? "warn" : "neutral"}
          />
          <MetricBar
            label="Snack-style %"
            value={analysis.snackHeavyPct}
            max={100}
            tone={analysis.snackHeavyPct != null && analysis.snackHeavyPct > 30 ? "warn" : "good"}
          />
        </div>
        {secondary.length > 0 ? (
          <ul className="mt-3.5 space-y-1 text-[12.5px] leading-relaxed text-(--color-fg-muted)">
            {secondary.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="select-none text-(--color-fg-dim)">·</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {analysis.avgFiberG != null ? (
          <p className="mt-2 text-[11px] text-(--color-fg-dim)">
            Avg fibre ~{analysis.avgFiberG.toFixed(1)}g / 100g
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={() => clearBasket()}
          className="text-sm text-(--color-fg-dim) hover:text-(--color-fg)"
        >
          Clear cart
        </button>
        <Link
          href="/search"
          className="text-sm font-medium text-(--color-accent) hover:opacity-80"
        >
          Add more items
        </Link>
      </div>
    </div>
  );
}

function CartLine({
  product,
  qty,
  fit,
  swaps,
}: {
  product: ProductListItem;
  qty: number;
  fit: ReturnType<typeof computeGoalFit> | null;
  swaps: SwapSuggestion[];
}) {
  const [replacing, setReplacing] = useState<string | null>(null);
  const score = fit?.fit ?? product.core_scores?.score;
  const surface = score != null ? scoreTileSurface(score) : null;

  return (
    <li className="p-4">
      <div className="flex gap-3 sm:gap-4">
        <Link
          href={`/product/${product.slug}`}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-(--color-line) bg-(--color-bg-soft) sm:h-[4.5rem] sm:w-[4.5rem]"
        >
          {product.image_urls[0] ? (
            <Image
              src={product.image_urls[0]}
              alt={product.name}
              fill
              className="object-contain p-1.5"
            />
          ) : null}
        </Link>

        <div className="min-w-0 flex-1">
          {product.subcategory || product.category ? (
            <p className="mb-0.5 truncate text-[10px] font-medium uppercase tracking-[0.1em] text-(--color-fg-dim)">
              {product.subcategory ?? product.category}
            </p>
          ) : null}
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/product/${product.slug}`}
              className="line-clamp-2 text-[14px] font-medium leading-snug text-(--color-fg) hover:text-(--color-accent)"
            >
              {product.name}
            </Link>
            {surface && score != null ? (
              <span
                className="flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-lg border font-display text-base tabular-nums leading-none"
                style={{
                  backgroundColor: surface.backgroundColor,
                  borderColor: surface.borderColor,
                  color: surface.accentColor,
                }}
              >
                {Math.round(score)}
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {product.price_inr != null ? (
              <span className="font-semibold tabular-nums text-(--color-fg)">
                ₹{product.price_inr * qty}
              </span>
            ) : null}
            {fit?.shortReason ? (
              <span className="text-[12px] text-(--color-fg-muted)">{fit.shortReason}</span>
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-(--color-line) bg-(--color-bg-soft) p-0.5">
              <button
                type="button"
                aria-label="Remove one"
                onClick={() => decrementBasket(product.slug)}
                className="u-press grid h-7 w-7 place-items-center rounded-full bg-(--color-panel) text-(--color-fg-muted) transition hover:bg-(--color-fg) hover:text-(--color-bg)"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[1.25rem] text-center text-sm font-semibold tabular-nums">
                {qty}
              </span>
              <button
                type="button"
                aria-label="Add one"
                onClick={() => addToBasket(product.slug, product.name)}
                className="u-press grid h-7 w-7 place-items-center rounded-full bg-(--color-fg) text-(--color-bg) transition hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              aria-label="Remove from cart"
              onClick={() => removeFromBasket(product.slug)}
              className="u-press grid h-8 w-8 place-items-center rounded-lg text-(--color-fg-dim) transition hover:bg-(--color-bg-soft) hover:text-(--color-bad)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {swaps.length > 0 ? (
        <details className="group/swaps mt-3 border-t border-(--color-line) pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] text-(--color-fg-muted) transition marker:content-none [&::-webkit-details-marker]:hidden group-open/swaps:bg-(--color-accent-soft) group-open/swaps:text-(--color-fg)">
            <ChevronDown className="h-3.5 w-3.5 transition group-open/swaps:rotate-180" />
            {swaps.length} better swap{swaps.length === 1 ? "" : "s"} in{" "}
            {product.subcategory ?? product.category ?? "this aisle"}
          </summary>
          <ul className="mt-3 space-y-2">
            {swaps.map(({ product: alt, goalFit, deltas }) => (
              <li
                key={alt.id}
                className="u-lift flex items-center gap-3 rounded-xl border border-(--color-line) bg-(--color-bg-soft) p-2.5"
              >
                <Link
                  href={`/product/${alt.slug}`}
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-(--color-panel)"
                >
                  {alt.image_urls[0] ? (
                    <Image
                      src={alt.image_urls[0]}
                      alt={alt.name}
                      fill
                      className="object-contain p-1"
                      sizes="48px"
                    />
                  ) : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/product/${alt.slug}`}
                    className="line-clamp-1 text-[13px] font-medium text-(--color-fg) hover:text-(--color-accent)"
                  >
                    {alt.name}
                  </Link>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-(--color-fg-muted)">
                    {deltas.length > 0 ? deltas.join(" · ") : "Stronger same-aisle pick"}
                    {alt.price_inr != null ? ` · ₹${alt.price_inr}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={replacing === alt.slug}
                  onClick={() => {
                    setReplacing(alt.slug);
                    replaceInBasket(product.slug, alt.slug, alt.name);
                    window.setTimeout(() => setReplacing(null), 400);
                  }}
                  className="u-press inline-flex shrink-0 items-center gap-1 rounded-lg border border-(--color-line) bg-(--color-panel) px-2.5 py-1.5 text-[11px] font-medium text-(--color-fg) transition hover:border-(--color-line-strong) disabled:opacity-50"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  {replacing === alt.slug ? "…" : "Swap"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function MetricBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number | null;
  max: number;
  tone: "good" | "warn" | "neutral";
}) {
  const pct = value != null ? Math.min(100, (value / max) * 100) : 0;
  const bar =
    tone === "good"
      ? "bg-(--color-good)"
      : tone === "warn"
        ? "bg-(--color-warn)"
        : "bg-(--color-fg-dim)";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-(--color-fg-muted)">{label}</span>
        <span className="font-medium tabular-nums text-(--color-fg)">
          {value != null ? value.toFixed(value < 10 ? 1 : 0) : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-(--color-line)">
        <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EmptyCart({
  hasStoredItems,
  fetchFailed,
  unresolvedEntries,
}: {
  hasStoredItems: boolean;
  fetchFailed: boolean;
  unresolvedEntries: ReturnType<typeof readBasket>;
}) {
  if (!hasStoredItems) {
    return (
      <div className="panel-soft rounded-2xl">
        <EmptyState
          title="Your basket's empty"
          action={
            <Link
              href="/search"
              className="u-press inline-flex rounded-full bg-(--color-fg) px-5 py-2.5 text-sm font-medium text-(--color-bg) transition hover:opacity-90"
            >
              Browse the catalog
            </Link>
          }
        >
          Add a few items and Scout grades the whole basket — then quietly points you to cleaner
          swaps, aisle by aisle.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-(--color-line) bg-(--color-panel) px-6 py-16 text-center">
      <ShoppingBag className="mx-auto h-9 w-9 text-(--color-fg-dim)" strokeWidth={1.5} />
      {hasStoredItems ? (
        <>
          <p className="mt-4 text-lg font-medium text-(--color-fg)">
            {fetchFailed ? "Couldn\u2019t load your cart" : "Some items couldn\u2019t be loaded"}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-(--color-fg-muted)">
            {fetchFailed
              ? "Check your connection and try again."
              : `${unresolvedEntries.length} saved item${unresolvedEntries.length === 1 ? "" : "s"} no longer match our catalog.`}
          </p>
          {unresolvedEntries.length > 0 && !fetchFailed ? (
            <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left">
              {unresolvedEntries.map((e) => (
                <li
                  key={e.slug}
                  className="flex items-center justify-between gap-3 rounded-xl border border-(--color-line) bg-(--color-bg-soft) px-3 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm">{e.name ?? e.slug}</span>
                  <button
                    type="button"
                    onClick={() => removeFromBasket(e.slug)}
                    className="text-xs text-(--color-fg-dim) hover:text-(--color-bad)"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {fetchFailed ? (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("scout-basket"))}
                className="rounded-full bg-(--color-fg) px-5 py-2.5 text-sm font-medium text-(--color-bg) hover:opacity-90"
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => clearBasket()}
              className="rounded-full border border-(--color-line) px-5 py-2.5 text-sm font-medium hover:bg-(--color-bg-soft)"
            >
              Clear cart
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-4 text-lg font-medium text-(--color-fg)">Your cart is empty</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-(--color-fg-muted)">
            Add items from the catalog — we&apos;ll score your cart and suggest swaps here.
          </p>
          <Link
            href="/search"
            className="mt-8 inline-flex rounded-full bg-(--color-fg) px-5 py-2.5 text-sm font-medium text-(--color-bg) hover:opacity-90"
          >
            Browse catalog
          </Link>
        </>
      )}
    </div>
  );
}
