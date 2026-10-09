"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Info, Search, X } from "lucide-react";
import { SearchResultCard } from "@/components/search/search-result-card";
import { SavedSearchActions } from "@/components/saved-search-actions";
import { useAuth } from "@/lib/auth/context";
import { hasSavedPreferences, readAiSearchPreferences, type AiSearchPreferences } from "@/lib/search/preferences";
import { readRecentSearches, recordRecentSearch } from "@/lib/search/recent-searches";
import type { SearchCard, SearchResponse } from "@/lib/search/planned/present";
import { SHELVES } from "@/lib/shelves";

const EXAMPLES = [
  "gluten free biscuits under ₹100",
  "healthier than maggi",
  "high protein snacks for the gym",
  "chips without palm oil",
  "bina cheeni wala biscuit",
  "tiffin snacks for kids",
];

type SortId = "best" | "price" | "score" | "protein";
const SORTS: { id: SortId; label: string }[] = [
  { id: "best", label: "Best match" },
  { id: "price", label: "Price: low to high" },
  { id: "score", label: "Health score" },
  { id: "protein", label: "Protein" },
];

type Status = { kind: "idle" } | { kind: "loading"; query: string } | { kind: "done"; data: SearchResponse } | { kind: "error"; query: string; message: string };

function sortCards(cards: SearchCard[], sort: SortId): SearchCard[] {
  if (sort === "best") return cards;
  const val = (c: SearchCard) =>
    sort === "price" ? c.price_inr ?? Infinity : sort === "score" ? -(c.score ?? -1) : -(c.nutrition.protein_g ?? -1);
  return [...cards].sort((a, b) => val(a) - val(b));
}

function LoadingState({ query }: { query: string }) {
  const steps = ["Understanding your request", "Searching every product", "Checking labels against what you asked"];
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const t1 = setTimeout(() => setStep(1), 1200);
    const t2 = setTimeout(() => setStep(2), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [query]);
  return (
    <div aria-live="polite">
      <p className="mb-5 flex items-center gap-2 text-sm text-(--color-fg-muted)">
        <span className="h-2 w-2 animate-pulse rounded-full bg-(--color-accent)" />
        {steps[step]}…
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-(--color-line) bg-(--color-panel)">
            <div className="aspect-square animate-pulse bg-(--color-bg-soft)" />
            <div className="space-y-2 p-3.5">
              <div className="h-3 w-1/3 animate-pulse rounded bg-(--color-bg-soft)" />
              <div className="h-3.5 w-5/6 animate-pulse rounded bg-(--color-bg-soft)" />
              <div className="h-3.5 w-1/4 animate-pulse rounded bg-(--color-bg-soft)" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StartState({ onPick }: { onPick: (q: string) => void }) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecentSearches().slice(0, 6)), []);
  return (
    <div className="grid gap-10">
      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-(--color-fg-dim)">Recent</h2>
          <div className="flex flex-wrap gap-2">
            {recent.map(q => (
              <button key={q} type="button" onClick={() => onPick(q)} className="rounded-full border border-(--color-line) bg-(--color-panel) px-3.5 py-1.5 text-sm text-(--color-fg-muted) hover:border-(--color-line-strong) hover:text-(--color-fg)">{q}</button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-(--color-fg-dim)">Try asking</h2>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map(q => (
            <button key={q} type="button" onClick={() => onPick(q)} className="rounded-full border border-(--color-line) bg-(--color-panel) px-3.5 py-1.5 text-sm text-(--color-fg-muted) hover:border-(--color-line-strong) hover:text-(--color-fg)">{q}</button>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-(--color-fg-dim)">Or start from a shelf</h2>
          <Link href="/shelves" className="text-sm text-(--color-accent) hover:underline">All shelves</Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SHELVES.slice(0, 6).map(s => (
            <Link key={s.slug} href={`/shelves/${s.slug}`} className="group flex items-start gap-3 rounded-2xl border border-(--color-line) bg-(--color-panel) p-4 hover:border-(--color-line-strong)">
              <span className="text-2xl" aria-hidden>{s.emoji}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-medium text-(--color-fg)">{s.title}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" aria-hidden /></span>
                <span className="mt-0.5 block text-sm text-(--color-fg-muted)">{s.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Results({ data, prefs }: { data: SearchResponse; prefs: AiSearchPreferences | null }) {
  const [sort, setSort] = useState<SortId>("best");
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  useEffect(() => { setSort("best"); setShowUnconfirmed(data.items.length === 0); }, [data]);
  const items = useMemo(() => sortCards(data.items, sort), [data.items, sort]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight text-(--color-fg) md:text-[1.75rem]">{data.summary}</h1>
          {data.chips.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-(--color-fg-dim)">Scout understood</span>
              {data.chips.map(c => (
                <span key={c} className="rounded-full border border-(--color-line) bg-(--color-panel) px-2.5 py-0.5 text-xs font-medium text-(--color-fg-muted)">{c}</span>
              ))}
            </div>
          )}
        </div>
        {data.items.length > 1 && (
          <label className="relative flex shrink-0 items-center gap-2 text-sm text-(--color-fg-muted)">
            <span className="sr-only">Sort results</span>
            <select value={sort} onChange={e => setSort(e.target.value as SortId)} className="cursor-pointer appearance-none rounded-full border border-(--color-line) bg-(--color-panel) py-1.5 pl-3.5 pr-8 text-sm text-(--color-fg) outline-none hover:border-(--color-line-strong)">
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4" aria-hidden />
          </label>
        )}
      </div>

      {data.degraded && (
        <p className="flex items-start gap-2 rounded-xl border border-(--color-warn)/30 bg-(--color-accent-soft) px-3.5 py-2.5 text-sm text-(--color-fg-muted)">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-(--color-warn)" aria-hidden />
          Search understanding is limited right now, so these are the closest text matches without filters.
        </p>
      )}
      {data.notes.length > 0 && (
        <ul className="grid gap-1 text-sm text-(--color-fg-muted)">
          {data.notes.map(n => <li key={n} className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-dim)" aria-hidden />{n}</li>)}
        </ul>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map(card => <SearchResultCard key={card.id} card={card} query={data.query} />)}
        </div>
      )}

      {data.unconfirmed.length > 0 && (
        <section className="rounded-2xl border border-dashed border-(--color-line-strong) p-4">
          <button type="button" onClick={() => setShowUnconfirmed(v => !v)} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={showUnconfirmed}>
            <span>
              <span className="font-medium text-(--color-fg)">Couldn&apos;t confirm from the label ({data.unconfirmed.length})</span>
              <span className="mt-0.5 block text-sm text-(--color-fg-muted)">These may fit, but their ingredient list or nutrition panel doesn&apos;t say enough to be sure. Check the pack.</span>
            </span>
            <ChevronDown className={`h-5 w-5 shrink-0 transition ${showUnconfirmed ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {showUnconfirmed && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.unconfirmed.map(card => <SearchResultCard key={card.id} card={card} query={data.query} muted />)}
            </div>
          )}
        </section>
      )}

      {items.length === 0 && data.unconfirmed.length === 0 && (
        <div className="rounded-2xl border border-(--color-line) bg-(--color-panel) p-6 text-sm text-(--color-fg-muted)">
          {data.intent === "non_food" || data.intent === "unclear"
            ? "Try describing a food or drink — for example “low sugar biscuits” or “paneer under ₹100”."
            : "Try fewer requirements, or describe it differently."}
        </div>
      )}

      {data.items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--color-line) pt-4">
          <SavedSearchActions query={data.query} preferences={prefs} />
          <p className="text-xs text-(--color-fg-dim)">Scores and checks come from the printed label. Always check the pack if it matters medically.</p>
        </div>
      )}
    </div>
  );
}

export function SearchView({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const auth = useAuth();
  const urlQuery = (params.get("q") ?? params.get("prompt") ?? "").trim();
  const [input, setInput] = useState(initialQuery || urlQuery);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [prefs, setPrefs] = useState<AiSearchPreferences | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = readAiSearchPreferences();
    setPrefs(hasSavedPreferences(p) ? p : null);
  }, []);

  const run = useCallback(async (q: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus({ kind: "loading", query: q });
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          ...(auth?.session?.access_token ? { authorization: `Bearer ${auth.session.access_token}` } : {}),
        },
        body: JSON.stringify({ q, limit: 24, preferences: prefs }),
      });
      const body = await res.json().catch(() => null);
      if (ctrl.signal.aborted) return;
      if (!res.ok || !body) throw new Error(body?.error ?? "Search is temporarily unavailable.");
      recordRecentSearch(q);
      setStatus({ kind: "done", data: body as SearchResponse });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setStatus({ kind: "error", query: q, message: e instanceof Error ? e.message : "Search failed" });
    }
  }, [auth?.session?.access_token, prefs]);

  // The URL is the source of truth: typing never searches by itself, submitting
  // (or back/forward) changes ?q= and that runs the search.
  useEffect(() => {
    setInput(urlQuery);
    if (urlQuery.length >= 2) void run(urlQuery);
    else setStatus({ kind: "idle" });
    // `run` changes when auth/preferences load; only the query should trigger a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    setInput(trimmed);
    if (trimmed === urlQuery) void run(trimmed);
    else router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    inputRef.current?.blur();
  };

  return (
    <div className="grid gap-7">
      <form onSubmit={e => { e.preventDefault(); submit(input); }} role="search" className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-(--color-fg-dim)" aria-hidden />
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Describe what you want — “low sugar biscuits under ₹100”"
          aria-label="Search Scout"
          enterKeyHint="search"
          className="h-14 w-full rounded-2xl border border-(--color-line-strong) bg-(--color-panel) pl-12 pr-28 text-[16px] text-(--color-fg) shadow-[0_2px_12px_-8px_rgba(0,0,0,0.3)] outline-none placeholder:text-(--color-fg-dim) focus:border-(--color-fg-muted)"
        />
        {input && (
          <button type="button" onClick={() => { setInput(""); inputRef.current?.focus(); }} className="absolute right-[92px] top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-(--color-fg-dim) hover:text-(--color-fg)" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
        <button type="submit" className="absolute right-2 top-1/2 h-10 -translate-y-1/2 rounded-xl bg-(--color-fg) px-4 text-sm font-medium text-(--color-bg) hover:opacity-90">
          Search
        </button>
      </form>

      {status.kind === "idle" && <StartState onPick={submit} />}
      {status.kind === "loading" && <LoadingState query={status.query} />}
      {status.kind === "error" && (
        <div className="rounded-2xl border border-(--color-line) bg-(--color-panel) p-6">
          <p className="font-medium text-(--color-fg)">{status.message}</p>
          <button type="button" onClick={() => void run(status.query)} className="mt-3 text-sm text-(--color-accent) hover:underline">Try again</button>
        </div>
      )}
      {status.kind === "done" && <Results data={status.data} prefs={prefs} />}
    </div>
  );
}
