"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi } from "@/components/admin-shell";

type Product = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  images: string[];
  ocr_status?: "untagged" | "tagged" | "skipped";
};

const BATCH_SIZE = 100;

export default function ImageTaggerPage() {
  const api = useAdminApi();
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [heroMap, setHeroMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Search mode
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const fetchBatch = useCallback(async () => {
    setLoading(true);
    setHeroMap({});
    setMessage(null);
    setSearchActive(false);
    try {
      const res = await api.fetch(`/api/admin/reorder-images?count=${BATCH_SIZE}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(err.error ?? `Failed to fetch (${res.status})`);
        setProducts([]);
        return;
      }
      const data = (await res.json()) as {
        done: number;
        total: number;
        products: Product[];
      };
      setDone(data.done);
      setTotal(data.total);
      setProducts(data.products ?? []);
    } catch {
      setMessage("Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void fetchBatch();
  }, [fetchBatch]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      void fetchBatch();
      return;
    }
    setSearchLoading(true);
    setSearchActive(true);
    setHeroMap({});
    setMessage(null);
    try {
      const res = await api.fetch(`/api/admin/reorder-images?search=${encodeURIComponent(q.trim())}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(err.error ?? "Search failed");
        return;
      }
      const data = (await res.json()) as {
        done?: number;
        total?: number;
        products: Product[];
      };
      setProducts(data.products ?? []);
      setMessage(`${data.products.length} results for "${q.trim()}"`);
    } catch {
      setMessage("Search failed");
    } finally {
      setSearchLoading(false);
    }
  }, [api, fetchBatch]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void doSearch(searchQuery);
    }
    if (e.key === "Escape") {
      setSearchQuery("");
      if (searchActive) void fetchBatch();
    }
  };

  const toggleHero = (productId: string, url: string) => {
    setHeroMap((prev) => {
      const next = { ...prev };
      if (next[productId] === url) {
        delete next[productId];
      } else {
        next[productId] = url;
      }
      return next;
    });
  };

  const heroCount = Object.keys(heroMap).length;

  const saveBatch = useCallback(async () => {
    if (heroCount === 0) return;
    setSaving(true);
    // Save selected heroes AND auto-skip the rest
    const actions = products.map((p) => {
      const heroUrl = heroMap[p.id];
      if (heroUrl) {
        return { productId: p.id, heroUrl, reorder: true };
      }
      return { productId: p.id, skip: true };
    });
    try {
      const res = await api.fetch("/api/admin/reorder-images", {
        method: "POST",
        body: JSON.stringify({ actions }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      const failed = (data as { failed?: number }).failed ?? 0;
      setDone((d) => d + products.length - failed);
      setMessage(`Saved ${heroCount - failed}, skipped ${products.length - heroCount}${failed > 0 ? ` — ${failed} FAILED` : ""}`);
      void fetchBatch();
    } catch {
      setMessage("Save failed");
    } finally {
      setSaving(false);
    }
  }, [api, heroMap, heroCount, products, fetchBatch]);

  const skipAll = useCallback(async () => {
    if (products.length === 0) return;
    setSaving(true);
    const actions = products.map((p) => ({
      productId: p.id,
      skip: true,
    }));
    try {
      const res = await api.fetch("/api/admin/reorder-images", {
        method: "POST",
        body: JSON.stringify({ actions }),
      });
      if (!res.ok) throw new Error("Skip failed");
      setDone((d) => d + products.length);
      setMessage(`Skipped ${products.length} products`);
      void fetchBatch();
    } catch {
      setMessage("Skip failed");
    } finally {
      setSaving(false);
    }
  }, [api, products, fetchBatch]);

  const skipOne = useCallback(
    async (productId: string) => {
      setSaving(true);
      try {
        const res = await api.fetch("/api/admin/reorder-images", {
          method: "POST",
          body: JSON.stringify({
            actions: [{ productId, skip: true }],
          }),
        });
        if (!res.ok) throw new Error("Skip failed");
        setDone((d) => d + 1);
        setProducts((prev) => prev.filter((p) => p.id !== productId));
        setHeroMap((prev) => {
          const next = { ...prev };
          delete next[productId];
          return next;
        });
        setMessage("Skipped");
      } catch {
        setMessage("Skip failed");
      } finally {
        setSaving(false);
      }
    },
    [api],
  );

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const remaining = total - done;

  const isLoading = loading || searchLoading;

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="mx-auto h-5 w-48 rounded bg-(--color-bg-soft)" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Array.from({ length: 100 }).map((_, i) => (
              <div key={i} className="aspect-[9/16] rounded-xl bg-(--color-bg-soft)" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6">
      {/* Top bar with search */}
      <div className="mb-4 space-y-3">
        {/* Search row */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search products by name or brand…"
              className="w-full rounded-xl border border-(--color-line-strong) bg-(--color-bg) px-4 py-2 text-[13px] text-(--color-fg) outline-none placeholder:text-(--color-fg-dim) focus:border-(--color-fg-muted)"
            />
            {searchQuery.trim() ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); void fetchBatch(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-(--color-fg-dim) hover:text-(--color-fg)"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void doSearch(searchQuery)}
            disabled={!searchQuery.trim() || saving}
            className="rounded-xl bg-(--color-fg) px-5 py-2 text-[13px] font-semibold text-(--color-bg) transition hover:opacity-80 disabled:opacity-40"
          >
            Search
          </button>
        </div>

        {/* Progress + actions row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3">
              <span className="font-semibold text-sm text-(--color-fg)">
                {searchActive
                  ? `${products.length} results`
                  : `${done.toLocaleString()} / ${total.toLocaleString()}`}
              </span>
              {!searchActive ? (
                <span className="text-[12px] text-(--color-fg-dim)">
                  {remaining > 0
                    ? `${remaining.toLocaleString()} left · ${pct}%`
                    : "Done!"}
                </span>
              ) : null}
            </div>
            {!searchActive ? (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-(--color-line)/40">
                <div
                  className="h-full rounded-full bg-(--color-accent) transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={skipAll}
              disabled={saving || products.length === 0}
              className="rounded-full border border-(--color-line) px-4 py-1.5 text-[12px] font-medium text-(--color-fg-muted) transition hover:border-(--color-fg-dim) hover:text-(--color-fg) disabled:opacity-40"
            >
              Skip all {products.length}
            </button>
            {heroCount > 0 ? (
              <button
                type="button"
                onClick={() => void saveBatch()}
                disabled={saving}
                className="rounded-full bg-(--color-fg) px-4 py-1.5 text-[12px] font-semibold text-(--color-bg) transition hover:opacity-80 disabled:opacity-40"
              >
                Save {heroCount} selected
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {message ? (
        <p className="mb-3 text-center text-[11px] text-(--color-fg-dim)">{message}</p>
      ) : null}

      {/* Product grid — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {products.map((p) => {
          const hero = heroMap[p.id];
          return (
            <article
              key={p.id}
              className="flex flex-col rounded-lg border border-(--color-line) bg-(--color-panel) p-1.5"
            >
              {/* Brand + Name — compact */}
              <div className="mb-1">
                {p.brand ? (
                  <p className="truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-(--color-fg-dim)">
                    {p.brand}
                  </p>
                ) : null}
                <p className="text-[11px] font-medium leading-tight text-(--color-fg) line-clamp-2">
                  {p.name}
                </p>
              </div>

              {/* Status badge — only in search mode */}
              {searchActive && p.ocr_status && p.ocr_status !== "untagged" ? (
                <div className="mb-1">
                  <span className={`inline-block rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${
                    p.ocr_status === "tagged"
                      ? "bg-(--color-accent)/15 text-(--color-accent)"
                      : "bg-(--color-warn)/15 text-(--color-warn)"
                  }`}>
                    {p.ocr_status === "tagged" ? "Tagged" : "Reviewed"}
                  </span>
                </div>
              ) : null}

              {/* Images — 2-column grid, show all */}
              <div className="grid grid-cols-2 gap-0.5">
                {p.images.map((url, idx) => {
                  const isHero = url === hero;
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => toggleHero(p.id, url)}
                      disabled={saving}
                      className={`relative aspect-square overflow-hidden rounded-md border transition ${
                        isHero
                          ? "border-(--color-accent) ring-1 ring-(--color-accent)/40"
                          : "border-(--color-line) hover:border-(--color-fg-dim)"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-contain p-1"
                        loading="lazy"
                      />
                      <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--color-fg) px-1 text-[8px] font-bold text-(--color-bg)">
                        {idx + 1}
                      </span>
                      {isHero ? (
                        <span className="absolute bottom-0 left-0 right-0 bg-(--color-accent) py-0.5 text-center text-[8px] font-semibold text-white">
                          hero
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => void skipOne(p.id)}
                disabled={saving}
                className="mt-1.5 w-full rounded-full border border-(--color-line) py-1 text-[10px] font-medium text-(--color-fg-dim) transition hover:border-(--color-fg-dim) hover:text-(--color-fg) disabled:opacity-40"
              >
                Skip
              </button>
            </article>
          );
        })}
      </div>

      {/* Bottom refresh */}
      {!searchActive && products.length < 100 && remaining > 0 ? (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => void fetchBatch()}
            disabled={saving}
            className="rounded-full border border-(--color-line) px-5 py-2 text-[13px] font-medium text-(--color-fg-muted) transition hover:border-(--color-fg-dim) hover:text-(--color-fg)"
          >
            Load more
          </button>
        </div>
      ) : null}
    </main>
  );
}
