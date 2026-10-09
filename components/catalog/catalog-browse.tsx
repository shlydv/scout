"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { SearchResultCard } from "@/components/search/search-result-card";
import { fetchCatalogMeta, fetchCatalogSearch, type CatalogMetaResponse } from "@/lib/products/catalog-api";
import { gridItemToCard } from "@/lib/products/card";
import { CATALOG_BAR_SORT_OPTIONS } from "@/lib/products/catalog-sort";
import type { CatalogGridItem } from "@/lib/products/queries";

const PAGE = 48;
const VERDICTS = [
  { id: "", label: "Any verdict" },
  { id: "daily_staple", label: "Daily staples" },
  { id: "good_choice", label: "Good choices" },
  { id: "occasional_treat", label: "Occasional treats" },
  { id: "skip", label: "Skip list" },
];
const PRICES = [0, 50, 100, 200, 500];

function Pill({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition ${active ? "border-(--color-fg) bg-(--color-fg) text-(--color-bg)" : "border-(--color-line) bg-(--color-panel) text-(--color-fg-muted) hover:border-(--color-line-strong) hover:text-(--color-fg)"}`}>
      {children}
    </button>
  );
}

function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="cursor-pointer appearance-none rounded-full border border-(--color-line) bg-(--color-panel) py-1.5 pl-3.5 pr-8 text-sm text-(--color-fg) outline-none hover:border-(--color-line-strong)">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-(--color-fg-muted)" aria-hidden />
    </label>
  );
}

export function CatalogBrowse({ initialMeta }: { initialMeta?: CatalogMetaResponse }) {
  const router = useRouter();
  const params = useSearchParams();
  const category = params.get("category") ?? "";
  const subcategory = params.get("subcategory") ?? "";
  const sort = params.get("sort") ?? "score-desc";
  const verdict = params.get("verdict") ?? "";
  const maxprice = params.get("maxprice") ?? "";

  const [meta, setMeta] = useState<CatalogMetaResponse | undefined>(initialMeta);
  const [subMeta, setSubMeta] = useState<string[]>([]);
  const [items, setItems] = useState<CatalogGridItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const setParam = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    router.push(`/catalog${next.toString() ? `?${next}` : ""}`, { scroll: false });
  }, [params, router]);

  useEffect(() => { if (!meta) void fetchCatalogMeta().then(setMeta).catch(() => {}); }, [meta]);
  useEffect(() => {
    setSubMeta([]);
    if (category) void fetchCatalogMeta(category).then(m => setSubMeta(m.filters.subcategories)).catch(() => {});
  }, [category]);

  const query = useMemo(() => ({ category, subcategory, sort, verdict, maxprice, limit: PAGE }), [category, subcategory, sort, verdict, maxprice]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPage(1);
    fetchCatalogSearch({ ...query, page: 1 })
      .then(r => { if (cancelled) return; setItems(r.items); setTotal(r.total); setHasMore(r.hasMore); })
      .catch(() => { if (!cancelled) { setItems([]); setHasMore(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  const loadMore = async () => {
    const next = page + 1;
    setLoading(true);
    try {
      const r = await fetchCatalogSearch({ ...query, page: next });
      setItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...r.items.filter(i => !seen.has(i.id))];
      });
      setPage(next);
      setHasMore(r.hasMore);
    } finally {
      setLoading(false);
    }
  };

  const categories = meta?.filters.categories ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl text-(--color-fg) md:text-4xl">{subcategory || category || "Browse every aisle"}</h1>
          <p className="mt-1 text-sm text-(--color-fg-muted)">
            {loading && !items.length ? "Loading…" : `${total.toLocaleString("en-IN")} products, scored from the back label`}
          </p>
        </div>
        <form role="search" onSubmit={e => { e.preventDefault(); if (q.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }} className="relative w-full md:w-96">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-fg-dim)" aria-hidden />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask Scout anything…" aria-label="Search Scout"
            className="h-11 w-full rounded-full border border-(--color-line-strong) bg-(--color-panel) pl-10 pr-4 text-[15px] outline-none placeholder:text-(--color-fg-dim) focus:border-(--color-fg-muted)" />
        </form>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        <Pill active={!category} onClick={() => setParam({ category: "", subcategory: "" })}>All aisles</Pill>
        {categories.map(c => <Pill key={c} active={c === category} onClick={() => setParam({ category: c, subcategory: "" })}>{c}</Pill>)}
      </div>
      {category && subMeta.length > 0 && (
        <div className="-mx-4 -mt-3 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <Pill active={!subcategory} onClick={() => setParam({ subcategory: "" })}>All {category.toLowerCase()}</Pill>
          {subMeta.map(s => <Pill key={s} active={s === subcategory} onClick={() => setParam({ subcategory: s })}>{s}</Pill>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select label="Sort" value={sort} onChange={v => setParam({ sort: v === "score-desc" ? "" : v })}>
          {CATALOG_BAR_SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.id === "score-desc" ? "Healthiest first" : o.label}</option>)}
        </Select>
        <Select label="Verdict" value={verdict} onChange={v => setParam({ verdict: v })}>
          {VERDICTS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </Select>
        <Select label="Max price" value={maxprice} onChange={v => setParam({ maxprice: v })}>
          {PRICES.map(p => <option key={p} value={p ? String(p) : ""}>{p ? `Under ₹${p}` : "Any price"}</option>)}
        </Select>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map(it => <SearchResultCard key={it.id} card={gridItemToCard(it)} query="" />)}
        </div>
      ) : !loading ? (
        <p className="rounded-2xl border border-(--color-line) bg-(--color-panel) p-6 text-sm text-(--color-fg-muted)">Nothing here with these filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-(--color-bg-soft)" />)}
        </div>
      )}

      {hasMore && (
        <button type="button" onClick={() => void loadMore()} disabled={loading} className="mx-auto rounded-full border border-(--color-line-strong) bg-(--color-panel) px-5 py-2 text-sm font-medium text-(--color-fg) hover:border-(--color-fg-muted) disabled:opacity-60">
          {loading ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}
