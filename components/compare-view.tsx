"use client";

import { rankPhrase } from "@/lib/utils";
import { productHref } from "@/lib/shopping/links";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import { ScoreRing, VerdictBadge } from "@/components/verdict-chips";
import {
  COMPARE_EVENT,
  clearCompare,
  readCompare,
  removeFromCompare,
} from "@/lib/compare/storage";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import { tierAccentForVerdict, sublabelChipLabels } from "@/lib/scoring/verdict-display";
import { parsePack } from "@/lib/facts/pack";
import { nutritionBasisUnit } from "@/lib/nutrition/nutrition-display";
import { catalogCardDisplayName } from "@/lib/products/card-display-name";
import { displayPriceInr } from "@/lib/products/display-price";
import type { ProductListItem } from "@/lib/products/queries";

type NutrientRow = {
  key: string;
  label: string;
  unit: string;
  /** "low" = lower is better, "high" = higher is better, "none" = no judgement */
  better: "low" | "high" | "none";
  field: keyof NonNullable<ProductListItem["nutrition"]>;
};

const NUTRIENT_ROWS: NutrientRow[] = [
  { key: "energy", label: "Energy", unit: "kcal", better: "low", field: "energy_kcal_100g" },
  { key: "protein", label: "Protein", unit: "g", better: "high", field: "protein_g_100g" },
  { key: "carbs", label: "Carbs", unit: "g", better: "none", field: "carbs_g_100g" },
  { key: "sugar", label: "Total sugar", unit: "g", better: "low", field: "sugar_g_100g" },
  { key: "added_sugar", label: "Added sugar", unit: "g", better: "low", field: "added_sugar_g_100g" },
  { key: "fiber", label: "Fibre", unit: "g", better: "high", field: "fiber_g_100g" },
  { key: "fat", label: "Total fat", unit: "g", better: "none", field: "fat_g_100g" },
  { key: "sat_fat", label: "Saturated fat", unit: "g", better: "low", field: "saturated_fat_g_100g" },
  { key: "sodium", label: "Sodium", unit: "mg", better: "low", field: "sodium_mg_100g" },
];

export function CompareView() {
  const [contexts, setContexts] = useState<Record<string, string>>({});
  const [slugs, setSlugs] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sync = () => {
      const entries = readCompare();
      setSlugs(entries.map(e => e.slug));
      setContexts(Object.fromEntries(entries.filter(e => e.shoppingContext).map(e => [e.slug, e.shoppingContext!])));
    };
    sync();
    window.addEventListener(COMPARE_EVENT, sync);
    return () => window.removeEventListener(COMPARE_EVENT, sync);
  }, []);

  const slugsKey = useMemo(() => [...slugs].sort().join(","), [slugs]);

  useEffect(() => {
    if (!slugsKey) {
      setProducts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/products?slugs=${encodeURIComponent(slugsKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: ProductListItem[]) => {
        if (cancelled) return;
        // Keep tray order, not API order.
        const bySlug = new Map(rows.map((p) => [p.slug, p]));
        setProducts(slugs.map((s) => bySlug.get(s)).filter(Boolean) as ProductListItem[]);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugsKey]);

  if (loading && slugs.length > 0) {
    return (
      <div className="grid gap-4 py-6" style={{ gridTemplateColumns: `repeat(${Math.max(2, slugs.length)}, minmax(0,1fr))` }}>
        {slugs.map((s) => (
          <div key={s} className="animate-pulse space-y-3">
            <div className="aspect-square rounded-2xl bg-(--color-bg-soft)" />
            <div className="h-4 w-3/4 rounded bg-(--color-bg-soft)" />
            <div className="h-24 rounded-xl bg-(--color-bg-soft)" />
          </div>
        ))}
      </div>
    );
  }

  if (products.length < 2) {
    return (
      <div className="rounded-2xl border border-(--color-line) bg-(--color-panel) px-6 py-16 text-center">
        <ArrowLeftRight className="mx-auto h-9 w-9 text-(--color-fg-dim)" strokeWidth={1.5} />
        <p className="mt-4 font-display text-[1.6rem] leading-tight text-(--color-fg)">
          {products.length === 1 ? "Add one more product" : "Nothing to compare yet"}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-(--color-fg-muted)">
          Tap the <ArrowLeftRight className="inline h-3 w-3" /> button on any product card to queue it
          here — then see them label to label.
        </p>
        <Link
          href="/search"
          className="u-press mt-8 inline-flex rounded-full bg-(--color-fg) px-5 py-2.5 text-sm font-medium text-(--color-bg) transition hover:opacity-90"
        >
          Browse catalog
        </Link>
      </div>
    );
  }

  const cols = products.length;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="min-w-[640px]">
        {/* Header cards */}
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
        >
          {products.map((p) => (
            <ProductHeader key={p.id} product={p} shoppingContext={contexts[p.slug]} />
          ))}
        </div>

        {/* Verdict + score row */}
        <CompareSection title="Scout verdict">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {products.map((p) => {
              const core = p.core_scores;
              const rank = rankPhrase(core?.category_rank ?? null, core?.category_size ?? null, core?.category_label ?? null);
              const verdict = core
                ? resolveProductVerdict({
                    verdict: core.verdict,
                    score: core.score,
                    name: p.name,
                    category: p.category,
                    subcategory: p.subcategory,
                  })
                : null;
              return (
                <div key={p.id} className="flex flex-col items-start gap-2 rounded-xl border border-(--color-line) bg-(--color-panel) p-3">
                  {core && verdict ? (
                    <>
                      <div className="flex w-full items-center justify-between gap-2">
                        <ScoreRing score={core.score} color={tierAccentForVerdict(verdict)} />
                        <VerdictBadge verdict={verdict} />
                      </div>
                      {rank ? (
                        <p className="text-[11px] leading-snug text-(--color-fg-muted)">
                          {rank}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[12px] text-(--color-fg-dim)">Not scored yet</p>
                  )}
                </div>
              );
            })}
          </div>
        </CompareSection>

        {/* Price */}
        <CompareSection title="Price">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {products.map((p) => {
              const price = displayPriceInr(p);
              const pack = parsePack(p.net_weight);
              const grams = pack && pack.unit !== "pcs" ? pack.qty : null;
              const per100 =
                price != null && grams != null && grams > 0
                  ? Math.round((price / grams) * 100)
                  : null;
              return (
                <div key={p.id} className="rounded-xl border border-(--color-line) bg-(--color-panel) p-3">
                  <p className="text-lg font-semibold tabular-nums text-(--color-fg)">
                    {price != null ? `₹${price}` : "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-(--color-fg-dim)">
                    {p.net_weight ?? ""}
                    {per100 != null ? ` · ₹${per100}/100${pack?.unit}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </CompareSection>

        {/* Nutrients per 100g with best/worst highlighting */}
        <CompareSection title="Nutrition · declared basis">
          <div className="overflow-hidden rounded-xl border border-(--color-line) bg-(--color-panel)">
            {NUTRIENT_ROWS.map((row, idx) => {
              const bases = products.map(p => nutritionBasisUnit(p.nutrition));
              const sameBasis = new Set(bases).size === 1;
              const values = products.map((p, i) => {
                const key = bases[i] === "ml" ? String(row.field).replace(/_100g$/, "_100ml") : row.field;
                const v = p.nutrition?.[key as keyof NonNullable<ProductListItem["nutrition"]>];
                return typeof v === "number" && Number.isFinite(v) ? v : null;
              });
              const present = values.filter((v): v is number => v != null);
              const distinct = new Set(present).size > 1;
              const best =
                sameBasis && row.better !== "none" && present.length >= 2 && distinct
                  ? row.better === "low"
                    ? Math.min(...present)
                    : Math.max(...present)
                  : null;
              const worst =
                sameBasis && row.better !== "none" && present.length >= 2 && distinct
                  ? row.better === "low"
                    ? Math.max(...present)
                    : Math.min(...present)
                  : null;
              return (
                <div
                  key={row.key}
                  className={`grid items-center gap-3 px-3 py-2 ${idx > 0 ? "border-t border-(--color-line)" : ""}`}
                  style={{ gridTemplateColumns: `110px repeat(${cols}, minmax(0,1fr))` }}
                >
                  <p className="text-[12px] text-(--color-fg-muted)">{row.label}</p>
                  {values.map((v, i) => {
                    const isBest = best != null && v === best;
                    const isWorst = worst != null && v === worst && v !== best;
                    return (
                      <p
                        key={products[i].id}
                        className="rounded-md px-2 py-1 text-[13px] font-medium tabular-nums"
                        style={{
                          color: isBest
                            ? "var(--color-good)"
                            : isWorst
                              ? "var(--color-bad)"
                              : "var(--color-fg)",
                          backgroundColor: isBest
                            ? "color-mix(in srgb, var(--color-good) 10%, transparent)"
                            : isWorst
                              ? "color-mix(in srgb, var(--color-bad) 8%, transparent)"
                              : "transparent",
                        }}
                      >
                        {v != null ? `${Math.round(v * 10) / 10} ${row.unit} / 100${bases[i]}` : "—"}
                      </p>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-(--color-fg-dim)">
            Highlights compare values only when every product uses the same basis. Volume and mass labels are not ranked against each other.
          </p>
        </CompareSection>

        {/* Signals */}
        <CompareSection title="Label signals">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {products.map((p) => {
              const labels = sublabelChipLabels(
                p.core_scores?.verdict_sublabels as string[] | undefined,
              ).slice(0, 4);
              return (
                <div key={p.id} className="rounded-xl border border-(--color-line) bg-(--color-panel) p-3">
                  {labels.length ? (
                    <ul className="space-y-1">
                      {labels.map((l) => (
                        <li key={l} className="text-[12px] leading-snug text-(--color-fg-muted)">
                          {l}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-(--color-fg-dim)">No signals recorded</p>
                  )}
                </div>
              );
            })}
          </div>
        </CompareSection>

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={clearCompare}
            className="text-sm text-(--color-fg-dim) underline-offset-4 hover:text-(--color-fg) hover:underline"
          >
            Clear comparison
          </button>
          <Link href="/search" className="text-sm font-medium text-(--color-accent) hover:opacity-80">
            Add more products
          </Link>
        </div>
      </div>
    </div>
  );
}

function ProductHeader({ product, shoppingContext }: { product: ProductListItem; shoppingContext?: string }) {
  const thumb = product.image_urls?.[0] ?? null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => removeFromCompare(product.slug)}
        aria-label={`Remove ${product.name} from comparison`}
        className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full border border-(--color-line) bg-(--color-panel) text-(--color-fg-dim) transition hover:text-(--color-bad)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <Link href={productHref(product.slug, shoppingContext)} className="group block">
        <div className="relative aspect-square overflow-hidden rounded-2xl photo-frame shadow-[0_1px_2px_rgba(60,40,20,0.05)] transition duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_34px_-20px_rgba(60,40,20,0.34)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)] dark:group-hover:shadow-[0_16px_34px_-18px_rgba(0,0,0,0.6)]">
          {thumb ? (
            <Image
              src={thumb}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, 280px"
              className="object-contain p-4 transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-(--color-fg-dim)">
              No image
            </div>
          )}
        </div>
        {product.brand ? (
          <p className="mt-2 truncate text-[10px] uppercase tracking-[0.12em] text-(--color-fg-dim)">
            {product.brand}
          </p>
        ) : null}
        <h2 className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug text-(--color-fg) group-hover:underline group-hover:underline-offset-2">
          {catalogCardDisplayName(product.name)}
        </h2>
      </Link>
    </div>
  );
}

function CompareSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-fg-dim)">
        {title}
      </p>
      {children}
    </section>
  );
}
