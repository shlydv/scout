"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { DietPicker } from "@/components/diet-picker";
import { GoalModePicker } from "@/components/goal-mode-picker";
import { ProductCard } from "@/components/product-card";
import { SearchCats } from "@/components/search-cats";
import { writeStoredGoal } from "@/lib/goals/storage";
import { GOAL_PROFILES, goalFromParam, type GoalId } from "@/lib/goals/types";
import { dietFromParam, type DietMode } from "@/lib/diet/types";
import { writeDietMode } from "@/lib/diet/storage";
import { saveCatalogReturnUrl } from "@/components/catalog-back-link";
import { EmptyState } from "@/components/empty-state";
import { Reveal } from "@/components/reveal";
import { useAuth } from "@/lib/auth/context";
import {
  catalogContextQuery,
  catalogSearchPath,
  parseCatalogParams,
  type CatalogFilterState,
} from "@/lib/products/catalog-filter";
import {
  CATALOG_SNAPSHOT_VERSION,
  catalogSnapshotForHref,
  clearCatalogSnapshot,
  isCatalogResultsView,
  registerCatalogSnapshot,
  type CatalogSearchSnapshot,
} from "@/lib/catalog/search-session";
import {
  fetchCatalogMeta,
  fetchAiCatalogSearch,
  fetchCatalogSearch,
  fetchLandingInsights,
  prefetchCatalogSearch,
  type CatalogGridItem,
  type CatalogMetaResponse,
} from "@/lib/products/catalog-api";
import { pickRotatingSlice } from "@/lib/catalog/landing-rotation";
import { useLandingRotationSlot } from "@/lib/catalog/use-landing-rotation-slot";
import type { LandingFact, LandingInsights } from "@/lib/products/landing-insights";
import { AiSavedPreferencesHint } from "@/components/ai-search-preferences";
import { SavedSearchActions } from "@/components/saved-search-actions";
import { setLastSearchContext } from "@/lib/search/v2/search-session";
import {
  hasSavedPreferences,
  readAiSearchPreferences,
  writeAiSearchPreferences,
  type AiSearchPreferences,
} from "@/lib/search/ai-usage";
import { readRecentSearches, recordRecentSearch } from "@/lib/search/recent-searches";
import type { DietaryPrevalenceMap } from "@/lib/search/v2/types";
import type { ParsedProductQuery } from "@/lib/search/query-parse";
import {
  CATALOG_BAR_SORT_OPTIONS,
  type CatalogSort,
} from "@/lib/products/catalog-sort";
import type { CatalogFilters, CatalogSearchResult, ProductListItem } from "@/lib/products/queries";
import { useRotatingPrompts } from "@/lib/catalog/use-rotating-prompts";
import type { Grade } from "@/lib/supabase/types";

type Params = {
  prompt?: string;
  q?: string;
  category?: string;
  subcategory?: string;
  usecase?: string;
  brand?: string;
  scored?: string;
  labelResolved?: string;
  deepseek?: string;
  min?: string;
  maxprice?: string;
  grade?: string;
  sort?: string;
  goal?: string;
  diet?: string;
  sublabel?: string;
  verdict?: string;
};

const EMPTY_FILTERS: CatalogFilters = {
  categories: [],
  subcategories: [],
  usecases: [],
  brands: [],
};

const inputClass =
  "w-full min-w-0 appearance-none rounded-none border-0 border-b border-(--color-line) bg-transparent py-2.5 text-[15px] text-(--color-fg) outline-none transition placeholder:text-(--color-fg-dim)/70 focus:border-(--color-fg-muted)";

const filterSelectClass =
  "w-full cursor-pointer appearance-none rounded-lg border border-(--color-line) bg-(--color-bg) py-2 pl-3 pr-9 text-sm text-(--color-fg) outline-none transition hover:border-(--color-line-strong) focus:border-(--color-fg-muted) focus:ring-1 focus:ring-(--color-line-strong) disabled:cursor-not-allowed disabled:opacity-50";

const CATALOG_PAGE_SIZE = 96;
const SEARCH_DEBOUNCE_MS = 250;

function countActiveFilters(state: CatalogFilterState): number {
  let n = 0;
  if (state.category) n++;
  if (state.subcategory) n++;
  if (state.usecase) n++;
  if (state.brand) n++;
  if (state.onlyScored) n++;
  if (state.onlyLabelResolved) n++;
  if (state.onlyDeepseek) n++;
  if (state.minScore > 0) n++;
  if (state.maxPrice > 0) n++;
  if (state.grade) n++;
  if (state.sublabel) n++;
  if (state.verdict) n++;
  return n;
}

const catalogBarButtonClass =
  "flex shrink-0 cursor-pointer list-none items-center gap-2 rounded-xl border border-(--color-line) bg-(--color-bg-soft)/40 px-4 py-2.5";

function sortBarLabel(sort: CatalogSort): string {
  return CATALOG_BAR_SORT_OPTIONS.find((o) => o.id === sort)?.label ?? "Score";
}

function FilterSelect({
  label,
  children,
  ...props
}: ComponentProps<"select"> & { label: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium tracking-wide text-(--color-fg-muted)">{label}</span>
      <div className="relative">
        <select className={filterSelectClass} {...props}>
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-fg-dim)"
          aria-hidden
        />
      </div>
    </label>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--color-line) bg-(--color-bg) px-3 py-1 text-[12px] text-(--color-fg) transition hover:border-(--color-line-strong) hover:bg-(--color-bg-soft)"
      title="Remove filter"
    >
      <span className="truncate">{label}</span>
      <span className="text-(--color-fg-dim)" aria-hidden>
        ×
      </span>
    </button>
  );
}

function buildSearchRequest(
  activeState: CatalogFilterState,
  debouncedQ: string,
  goal: GoalId,
  diet: DietMode,
  page: number,
) {
  return {
    q: debouncedQ.trim() || undefined,
    category: activeState.category || undefined,
    subcategory: activeState.subcategory || undefined,
    usecase: activeState.usecase || undefined,
    brand: activeState.brand || undefined,
    scored: activeState.onlyScored ? "1" : undefined,
    labelResolved: activeState.onlyLabelResolved ? "1" : undefined,
    deepseek: activeState.onlyDeepseek ? "1" : undefined,
    min: activeState.minScore > 0 ? activeState.minScore : undefined,
    maxprice: activeState.maxPrice > 0 ? activeState.maxPrice : undefined,
    grade: activeState.grade || undefined,
    sort: activeState.sort !== "score-desc" ? activeState.sort : undefined,
    goal: goal !== "balanced" ? goal : undefined,
    diet: diet !== "any" ? diet : undefined,
    sublabel: activeState.sublabel || undefined,
    verdict: activeState.verdict || undefined,
    page,
    limit: CATALOG_PAGE_SIZE,
  };
}

function paramsFromLocation(): Params {
  const sp = new URLSearchParams(window.location.search);
  return {
    q: sp.get("q") ?? undefined,
    prompt: sp.get("prompt") ?? undefined,
    category: sp.get("category") ?? undefined,
    subcategory: sp.get("subcategory") ?? undefined,
    usecase: sp.get("usecase") ?? undefined,
    brand: sp.get("brand") ?? undefined,
    scored: sp.get("scored") ?? undefined,
    labelResolved: sp.get("labelResolved") ?? undefined,
    deepseek: sp.get("deepseek") ?? undefined,
    min: sp.get("min") ?? undefined,
    maxprice: sp.get("maxprice") ?? undefined,
    grade: sp.get("grade") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    goal: sp.get("goal") ?? undefined,
    diet: sp.get("diet") ?? undefined,
    sublabel: sp.get("sublabel") ?? undefined,
    verdict: sp.get("verdict") ?? undefined,
  };
}

function normalizeState(
  state: CatalogFilterState,
  options: CatalogFilters,
): CatalogFilterState {
  const next = { ...state };
  if (next.category && !options.categories.includes(next.category)) {
    next.category = "";
    next.subcategory = "";
    next.usecase = "";
    next.brand = "";
  }
  if (next.subcategory && !options.subcategories.includes(next.subcategory)) {
    next.subcategory = "";
    next.usecase = "";
  }
  if (next.usecase && !options.usecases.includes(next.usecase)) {
    next.usecase = "";
  }
  if (next.brand && !options.brands.includes(next.brand)) {
    next.brand = "";
  }
  return next;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function preferencesFromParsed(parsed: ParsedProductQuery): AiSearchPreferences {
  return {
    diet: parsed.hard_constraints.vegan
      ? "vegan"
      : parsed.hard_constraints.vegetarian
        ? "vegetarian"
        : undefined,
    healthContexts: parsed.health_contexts.length ? parsed.health_contexts : undefined,
    avoidIngredients: parsed.hard_constraints.avoid_ingredients?.length
      ? parsed.hard_constraints.avoid_ingredients
      : undefined,
    budget: parsed.hard_constraints.max_price ?? null,
  };
}

function goalFromParams(params: Params): GoalId {
  return params.goal ? goalFromParam(params.goal) : "balanced";
}

function dietFromParams(params: Params): DietMode {
  return params.diet ? dietFromParam(params.diet) : "any";
}

function paramsKey(params: Params): string {
  return JSON.stringify(params);
}

function syncFromParams(params: Params): {
  state: CatalogFilterState;
  goal: GoalId;
  diet: DietMode;
} {
  return {
    state: parseCatalogParams(params),
    goal: goalFromParams(params),
    diet: dietFromParams(params),
  };
}

export function CatalogView({
  initialParams,
  initialMeta,
  initialSearch,
}: {
  initialParams: Params;
  initialMeta?: CatalogMetaResponse;
  initialSearch?: CatalogSearchResult;
}) {
  const [state, setState] = useState<CatalogFilterState>(() =>
    parseCatalogParams(initialParams),
  );
  const [goal, setGoal] = useState<GoalId>(() => goalFromParams(initialParams));
  const [diet, setDiet] = useState<DietMode>(() => dietFromParams(initialParams));
  const [meta, setMeta] = useState<CatalogMetaResponse | null>(initialMeta ?? null);
  const [metaReady, setMetaReady] = useState(Boolean(initialMeta));
  const [items, setItems] = useState<CatalogGridItem[]>(() => initialSearch?.items ?? []);
  const [goalFits, setGoalFits] = useState<Record<string, number>>(
    () => initialSearch?.goalFits ?? {},
  );
  const [total, setTotal] = useState(() => initialSearch?.total ?? 0);
  const [page, setPage] = useState(() => initialSearch?.page ?? 1);
  const [hasMore, setHasMore] = useState(() => initialSearch?.hasMore ?? false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showGoalHint, setShowGoalHint] = useState(false);
  const [loading, setLoading] = useState(() => !initialSearch);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const fetchGen = useRef(0);
  const skipParamsSync = useRef(true);
  const skipInitialSearch = useRef(Boolean(initialSearch));
  const sessionReadyRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const autoPromptRan = useRef(false);
  const goalSentinelRef = useRef<HTMLDivElement>(null);
  const [goalStripScrolledPast, setGoalStripScrolledPast] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(initialParams.prompt ?? initialParams.q ?? "");
  const [aiMode, setAiMode] = useState(false);
  const [factBrowse, setFactBrowse] = useState<{
    headline: string;
    items: ProductListItem[];
    total: number;
  } | null>(null);
  const [aiSearching, setAiSearching] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiParseSource, setAiParseSource] = useState<"deepseek" | "heuristic" | "cloudflare" | null>(null);
  const [aiRankSource, setAiRankSource] = useState<string | null>(null);
  const [aiIntentTier, setAiIntentTier] = useState<string | null>(null);
  const [aiRelaxed, setAiRelaxed] = useState(false);
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  const [aiRefinements, setAiRefinements] = useState<string[]>([]);
  const [aiRelaxationExplanations, setAiRelaxationExplanations] = useState<string[]>([]);
  const [aiParsed, setAiParsed] = useState<ParsedProductQuery | null>(null);
  const [dietaryPrevalence, setDietaryPrevalence] = useState<DietaryPrevalenceMap | null>(null);
  const [savedPrefs, setSavedPrefs] = useState<AiSearchPreferences | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const examplePrompts = useRotatingPrompts();
  const { session } = useAuth();

  const aiModeRef = useRef(false);

  const debouncedQ = useDebouncedValue(state.q, SEARCH_DEBOUNCE_MS);

  const applySessionSnapshot = useCallback((snap: CatalogSearchSnapshot) => {
    setState(snap.state);
    setGoal(snap.goal);
    setDiet(snap.diet);
    setItems(snap.items);
    setGoalFits(snap.goalFits);
    setTotal(snap.total);
    setPage(snap.page);
    setHasMore(snap.hasMore);
    setAiMode(snap.aiMode);
    setAiPrompt(snap.aiPrompt);
    setAiSummary(snap.aiSummary);
    setAiParseSource(snap.aiParseSource);
    setAiRankSource(snap.aiRankSource);
    setAiIntentTier(snap.aiIntentTier);
    setAiRelaxed(snap.aiRelaxed);
    setAiWarning(snap.aiWarning);
    setAiRefinements(snap.aiRefinements);
    setAiRelaxationExplanations(snap.aiRelaxationExplanations ?? []);
    setAiParsed(snap.aiParsed);
    setFactBrowse(snap.factBrowse);
    setLoading(false);
    setRefreshing(false);
    setLoadError(null);
    skipInitialSearch.current = true;
    if (snap.aiMode && snap.aiPrompt.trim()) {
      autoPromptRan.current = true;
    }
  }, []);

  const restoreSessionFromLocation = useCallback(() => {
    const href = `${window.location.pathname}${window.location.search}`;
    const snap = catalogSnapshotForHref(href);
    if (snap && isCatalogResultsView(snap)) {
      applySessionSnapshot(snap);
      return true;
    }
    return false;
  }, [applySessionSnapshot]);

  const initialKey = paramsKey(initialParams);
  useEffect(() => {
    if (skipParamsSync.current) {
      skipParamsSync.current = false;
      return;
    }
    if (!sessionReadyRef.current) return;
    const next = syncFromParams(initialParams);
    setState(next.state);
    setGoal(next.goal);
    setDiet(next.diet);
  }, [initialKey]);

  useEffect(() => {
    restoreSessionFromLocation();
    sessionReadyRef.current = true;
    setSessionReady(true);
  }, [restoreSessionFromLocation]);

  useEffect(() => {
    const onPop = () => {
      if (restoreSessionFromLocation()) return;
      const next = syncFromParams(paramsFromLocation());
      setState(next.state);
      setGoal(next.goal);
      setDiet(next.diet);
      setAiMode(false);
      setAiSummary(null);
      setAiWarning(null);
      setAiRefinements([]);
      setAiRelaxationExplanations([]);
      setAiParsed(null);
      setFactBrowse(null);
      skipInitialSearch.current = false;
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (restoreSessionFromLocation()) return;
      const next = syncFromParams(paramsFromLocation());
      setState(next.state);
      setGoal(next.goal);
      setDiet(next.diet);
      skipInitialSearch.current = false;
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [restoreSessionFromLocation]);

  useEffect(() => {
    setShowGoalHint(
      !localStorage.getItem("scout-goal-v1") && !localStorage.getItem("oasis-goal-v1"),
    );
    setSavedPrefs(readAiSearchPreferences());
    setRecentSearches(readRecentSearches());
  }, []);

  useEffect(() => {
    const el = goalSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setGoalStripScrolledPast(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-56px 0px 0px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [showGoalHint]);

  const filterOptions = meta?.filters ?? EMPTY_FILTERS;

  const activeState = useMemo(() => {
    if (!metaReady) return state;
    return normalizeState(state, filterOptions);
  }, [state, filterOptions, metaReady]);

  const productQuery = useMemo(() => {
    if (aiMode && aiPrompt.trim()) {
      return `?prompt=${encodeURIComponent(aiPrompt.trim())}`;
    }
    return catalogContextQuery(activeState, goal, { diet });
  }, [aiMode, aiPrompt, activeState, goal, diet]);

  // Keep aiModeRef in sync for closure-bound callbacks (patch, etc.)
  useEffect(() => { aiModeRef.current = aiMode; }, [aiMode]);

  // Search results already satisfy one server-owned decision and ordering.
  const displayedItems = items;

  const searchKey = useMemo(
    () =>
      JSON.stringify({
        q: debouncedQ.trim(),
        category: activeState.category,
        subcategory: activeState.subcategory,
        usecase: activeState.usecase,
        brand: activeState.brand,
        onlyScored: activeState.onlyScored,
        onlyLabelResolved: activeState.onlyLabelResolved,
        onlyDeepseek: activeState.onlyDeepseek,
        minScore: activeState.minScore,
        maxPrice: activeState.maxPrice,
        grade: activeState.grade,
        sort: activeState.sort,
        sublabel: activeState.sublabel,
        verdict: activeState.verdict,
        goal,
        diet,
      }),
    [
      debouncedQ,
      activeState.category,
      activeState.subcategory,
      activeState.usecase,
      activeState.brand,
      activeState.onlyScored,
      activeState.onlyLabelResolved,
      activeState.onlyDeepseek,
      activeState.minScore,
      activeState.maxPrice,
      activeState.grade,
      activeState.sort,
      activeState.sublabel,
      activeState.verdict,
      goal,
      diet,
    ],
  );

  useEffect(() => {
    if (initialMeta && !activeState.category) {
      setMeta(initialMeta);
      setMetaReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCatalogMeta(activeState.category || undefined);
        if (!cancelled) {
          setMeta(data);
          setMetaReady(true);
        }
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeState.category, initialMeta]);

  useEffect(() => {
    if (!sessionReady) return;
    if (aiMode) return;
    if (skipInitialSearch.current) {
      skipInitialSearch.current = false;
      return;
    }
    const gen = ++fetchGen.current;
    setLoadError(null);
    if (items.length > 0) setRefreshing(true);
    else setLoading(true);

    (async () => {
      try {
        const result = await fetchCatalogSearch(
          buildSearchRequest(activeState, debouncedQ, goal, diet, 1),
        );
        if (gen !== fetchGen.current) return;
        setItems(result.items);
        setGoalFits(result.goalFits);
        setTotal(result.total);
        setHasMore(result.hasMore);
        setPage(1);
      } catch (e) {
        if (gen !== fetchGen.current) return;
        setLoadError((e as Error).message);
        if (items.length === 0) {
          setTotal(0);
          setHasMore(false);
        }
      } finally {
        if (gen === fetchGen.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
  }, [searchKey, aiMode, sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    if (aiMode || !hasMore || loading || refreshing || loadError) return;
    prefetchCatalogSearch(buildSearchRequest(activeState, debouncedQ, goal, diet, page + 1));
  }, [aiMode, hasMore, page, searchKey, loading, refreshing, loadError, activeState, debouncedQ, goal, diet, sessionReady]);

  const loadMore = useCallback(async () => {
    if (aiMode) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const result = await fetchCatalogSearch(
        buildSearchRequest(activeState, debouncedQ, goal, diet, nextPage),
      );
      setItems((prev) => [...prev, ...result.items]);
      setGoalFits((prev) => ({ ...prev, ...result.goalFits }));
      setPage(nextPage);
      setHasMore(result.hasMore);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [aiMode, page, debouncedQ, activeState, goal, diet]);

  const catalogHref = useMemo(
    () => catalogSearchPath(activeState, goal, { diet, aiMode, aiPrompt }),
    [activeState, goal, diet, aiMode, aiPrompt],
  );

  useEffect(() => {
    if (!sessionReady) return;

    const snapshot: CatalogSearchSnapshot = {
      version: CATALOG_SNAPSHOT_VERSION,
      href: catalogHref,
      state: activeState,
      goal,
      diet,
      items,
      goalFits,
      total,
      page,
      hasMore,
      aiMode,
      aiPrompt,
      aiSummary,
      aiParseSource,
      aiRankSource,
      aiIntentTier,
      aiRelaxed,
      aiWarning,
      aiRefinements,
      aiRelaxationExplanations,
      aiParsed,
      factBrowse,
    };

    if (isCatalogResultsView(snapshot)) {
      registerCatalogSnapshot(snapshot);
    } else {
      registerCatalogSnapshot(null);
    }
  }, [
    sessionReady,
    catalogHref,
    activeState,
    goal,
    diet,
    items,
    goalFits,
    total,
    page,
    hasMore,
    aiMode,
    aiPrompt,
    aiSummary,
    aiParseSource,
    aiRankSource,
    aiIntentTier,
    aiRelaxed,
    aiWarning,
    aiRefinements,
    aiRelaxationExplanations,
    aiParsed,
    factBrowse,
  ]);

  const prevUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionReady) return;
    saveCatalogReturnUrl(catalogHref);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== catalogHref) {
      // pushState so browser back button can restore this exact filter state via bfcache
      window.history.pushState(null, "", catalogHref);
    }
    prevUrlRef.current = catalogHref;
  }, [catalogHref, sessionReady]);

  const pickGoal = useCallback((g: GoalId) => {
    writeStoredGoal(g);
    setShowGoalHint(false);
    setGoal(g);
  }, []);

  const pickDiet = useCallback((d: DietMode) => {
    writeDietMode(d);
    setDiet(d);
  }, []);

  const patch = useCallback((partial: Partial<CatalogFilterState>) => {
    // Reset subcategory chip selection when filters change

    if (aiModeRef.current) {
      // AI mode: client-side only — update state for filtering, don't destroy AI results
      setState((prev) => {
        const next = { ...prev, ...partial };
        if (partial.category !== undefined && partial.category !== prev.category) {
          next.subcategory = "";
          next.usecase = "";
          next.brand = "";
        }
        if (
          partial.subcategory !== undefined &&
          partial.subcategory !== prev.subcategory
        ) {
          next.usecase = "";
        }
        return next;
      });
      return;
    }
    // Catalog mode: reset AI state and apply filters for catalog search
    setAiMode(false);
    setAiSummary(null);
    setAiWarning(null);
    setAiRefinements([]);
    setAiRelaxationExplanations([]);
    setAiParsed(null);
    setState((prev) => {
      const next = { ...prev, ...partial };
      if (partial.category !== undefined && partial.category !== prev.category) {
        next.subcategory = "";
        next.usecase = "";
        next.brand = "";
      }
      if (
        partial.subcategory !== undefined &&
        partial.subcategory !== prev.subcategory
      ) {
        next.usecase = "";
      }
      return next;
    });
  }, []);

  const runAiSearch = useCallback(async (promptOverride?: string) => {
    const prompt = (promptOverride ?? aiPrompt).trim();
    if (!prompt) return;
    setLoadError(null);

    setAiIntentTier("structured");

    const gen = ++fetchGen.current;
    setAiSearching(true);
    setRefreshing(items.length > 0);
    try {
      const result = await fetchAiCatalogSearch(
        prompt,
        24,
        "structured",
        savedPrefs,
        session?.access_token,
      );
      if (gen !== fetchGen.current) return;
      setItems(result.items);
      setGoalFits({});
      setTotal(result.items.length);
      setPage(1);
      setHasMore(false);
      setAiMode(true);
      setRefineOpen(false);
      setFactBrowse(null);
      setDietaryPrevalence(result.dietary_prevalence ?? null);
      setAiSummary(result.summary);
      setAiParseSource(result.parse_source);
      setAiRankSource(result.rank_source);
      setAiIntentTier(result.intent_tier);
      setAiRelaxed(result.relaxed);
      setAiWarning(result.parse_warning ?? null);
      setAiRefinements(result.refinements);
      setAiRelaxationExplanations(result.relaxation_explanations ?? []);
      setAiParsed(result.parsed);
      setRecentSearches(recordRecentSearch(prompt));
      if (result.v2) {
        setLastSearchContext({
          query: prompt,
          goal_id: result.v2.goal_id,
          goal_phrase: result.v2.goal_phrase,
        });
      }
    } catch (e) {
      if (gen !== fetchGen.current) return;
      const err = e as Error;
      setLoadError(
        err.name === "AbortError"
          ? "Search took too long — try again in a moment."
          : err.message,
      );
    } finally {
      if (gen === fetchGen.current) {
        setAiSearching(false);
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [aiPrompt, items.length, savedPrefs, patch, session?.access_token]);

  const handleFactAction = useCallback(
    async (fact: LandingFact) => {
      setLoadError(null);
      setFactBrowse(null);
      setAiMode(false);
      const { action } = fact;

      if (action.type === "expose") {
        setRefreshing(true);
        setLoading(true);
        try {
          const slugs = action.slugs.slice(0, 40);
          const res = await fetch(`/api/products?slugs=${encodeURIComponent(slugs.join(","))}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const products = (await res.json()) as ProductListItem[];
          setFactBrowse({
            headline: fact.headline,
            items: products,
            total: action.slugs.length,
          });
          setItems(products as unknown as CatalogGridItem[]);
          setGoalFits({});
          setTotal(products.length);
          setPage(1);
          setHasMore(false);
        } catch (e) {
          setLoadError((e as Error).message);
        } finally {
          setRefreshing(false);
          setLoading(false);
        }
        return;
      }

      if (action.type === "catalog") {
        patch({
          sublabel: action.sublabel ?? "",
          verdict: action.verdict ?? "",
          sort: (action.sort ?? "score-desc") as CatalogSort,
        });
        return;
      }

      setAiPrompt(action.prompt);
      void runAiSearch(action.prompt);
    },
    [patch, runAiSearch],
  );

  useEffect(() => {
    if (autoPromptRan.current || !initialParams.prompt?.trim()) return;
    autoPromptRan.current = true;
    void runAiSearch(initialParams.prompt);
  }, [initialParams.prompt, runAiSearch]);

  const hasFilters = Boolean(
    activeState.q ||
      activeState.category ||
      activeState.subcategory ||
      activeState.usecase ||
      activeState.brand ||
      activeState.onlyScored ||
      activeState.onlyLabelResolved ||
      activeState.onlyDeepseek ||
      activeState.minScore > 0 ||
      activeState.maxPrice > 0 ||
      activeState.grade ||
      activeState.sublabel ||
      activeState.verdict ||
      activeState.sort !== "score-desc",
  );

  const clearAll = () => {
    clearCatalogSnapshot();
    registerCatalogSnapshot(null);
    setAiMode(false);
    setAiSummary(null);
    setAiWarning(null);
    setAiRefinements([]);
    setAiRelaxationExplanations([]);
    setAiParsed(null);
    setFactBrowse(null);
    setItems([]);
    setTotal(0);
    setHasMore(false);
    setPage(1);
    setState({
      q: "",
      category: "",
      subcategory: "",
      usecase: "",
      brand: "",
      onlyScored: false,
      onlyLabelResolved: false,
      onlyDeepseek: false,
      minScore: 0,
      maxPrice: 0,
      grade: "",
      sort: "score-desc",
      sublabel: "",
      verdict: "",
    });
  };

  const handleSublabelClick = useCallback((sublabel: string) => {
    patch({ sublabel: activeState.sublabel === sublabel ? "" : sublabel });
  }, [activeState.sublabel, patch]);

  const stats = meta?.stats;
  const activeFilterCount = countActiveFilters(activeState);

  if (loadError && !items.length && !meta) {
    return (
      <EmptyState
        title="Couldn't load the catalog"
        className="py-16"
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="u-press rounded-full border border-(--color-line) px-5 py-2 text-sm font-medium text-(--color-fg-muted) transition hover:border-(--color-fg) hover:text-(--color-fg)"
          >
            Try again
          </button>
        }
      >
        <p>
          Something hiccuped on our end — give it another go.{" "}
          <span className="text-(--color-fg-dim)">({loadError})</span>
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative space-y-3">
        <div ref={goalSentinelRef} className="h-px w-full shrink-0" aria-hidden />

        <section className="pb-0">
          <p className="font-display mb-3 text-2xl font-bold leading-tight tracking-tight text-(--color-fg) md:text-3xl">
            Ask Scout
          </p>
          <form
            className="flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runAiSearch();
            }}
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => {
                  setAiPrompt(e.target.value);
                  if (!e.target.value.trim() && aiMode) {
                    setAiPrompt("");
                    clearAll();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAiPrompt("");
                    clearAll();
                  }
                }}
                placeholder="e.g. paneer with low fat under ₹150"
                className="w-full min-h-[48px] rounded-2xl border border-(--color-line-strong) bg-(--color-bg) pl-5 pr-10 text-[15px] text-(--color-fg) outline-none ring-0 transition placeholder:text-(--color-fg-dim) focus:border-(--color-fg-muted) focus:shadow-md focus:ring-4 focus:ring-(--color-accent)/10"
              />
              {aiPrompt.trim() ? (
                <button
                  type="button"
                  onClick={() => {
                    setAiPrompt("");
                    clearAll();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-(--color-fg-dim) hover:text-(--color-fg)"
                  aria-label="Clear search"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                disabled={aiSearching}
                className="min-h-[48px] rounded-2xl bg-(--color-fg) px-6 text-sm font-semibold text-(--color-bg) transition hover:opacity-80 disabled:cursor-wait disabled:opacity-60"
              >
                {aiSearching ? "Searching…" : "Search"}
              </button>
              {!aiMode && <button
                type="button"
                title="Filters"
                aria-label="Open filters"
                onClick={() => setRefineOpen((o) => !o)}
                className="relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-(--color-line-strong) bg-(--color-bg) transition hover:border-(--color-fg-muted) hover:bg-(--color-bg-soft)"
              >
                <SlidersHorizontal className="h-4 w-4 text-(--color-fg-muted)" aria-hidden />
                {activeFilterCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-(--color-fg) px-1 text-[9px] font-bold text-(--color-bg)">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>}
            </div>
          </form>

          {/* Inline failure note — a failed ask must never look like a quiet no-op */}
          {loadError ? (
            <p className="mt-1.5 text-[12px] text-(--color-bad)" role="alert">
              {loadError}
            </p>
          ) : null}

          {/* Prompt chips — recent asks first, then rotating examples. Hidden when results show. */}
          {!aiMode && (
            <div className="edge-fade-x mt-3 -mx-1 overflow-x-auto px-1 pb-0.5 scrollbar-none">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                {recentSearches.length > 0 ? (
                  <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-(--color-fg-dim)">
                    Recent
                  </span>
                ) : null}
                {recentSearches.map((recent) => (
                  <button
                    key={`recent-${recent}`}
                    type="button"
                    onClick={() => {
                      setAiPrompt(recent);
                      void runAiSearch(recent);
                    }}
                    className="flex-shrink-0 rounded-full border border-(--color-line-strong) bg-(--color-bg-soft) px-3 py-1 text-[11px] font-medium text-(--color-fg-muted) transition hover:border-(--color-fg-dim) hover:text-(--color-fg)"
                  >
                    {recent}
                  </button>
                ))}
                {recentSearches.length > 0 ? (
                  <span className="h-4 w-px flex-shrink-0 bg-(--color-line)" aria-hidden />
                ) : null}
                {examplePrompts
                  .filter((e) => !recentSearches.some((r) => r.toLowerCase() === e.toLowerCase()))
                  .map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => {
                        setAiPrompt(example);
                        void runAiSearch(example);
                      }}
                      className="flex-shrink-0 rounded-full border border-(--color-line) px-3 py-1 text-[11px] text-(--color-fg-dim) transition hover:border-(--color-fg-dim) hover:text-(--color-fg)"
                    >
                      {example}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <AiSavedPreferencesHint prefs={savedPrefs} onChange={setSavedPrefs} />

        </section>

        {/* refreshing indicator */}
        {refreshing ? (
          <div className="flex justify-end">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-(--color-line-strong) border-t-transparent" />
          </div>
        ) : null}

        {refineOpen && !aiMode && (
          <div className="pop-in absolute right-0 top-full z-40 mt-2 w-72 origin-top-right rounded-2xl border border-(--color-line) bg-(--color-panel) shadow-[0_16px_48px_-16px_rgba(60,40,20,0.3)] ring-1 ring-black/[0.02] sm:w-80">
            <div className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-(--color-line) pb-3">
                <GoalModePicker value={goal} onChange={pickGoal} compact />
                <DietPicker value={diet} onChange={pickDiet} compact />
              </div>

              <FilterSelect
                label="Verdict"
                value={activeState.verdict}
                onChange={(e) => patch({ verdict: e.target.value })}
              >
                <option value="">All verdicts</option>
                <option value="daily_staple">Daily staples</option>
                <option value="good_choice">Good choices</option>
                <option value="occasional_treat">Treats</option>
                <option value="skip">Skip</option>
              </FilterSelect>

              <FilterSelect
                label="Aisles"
                value={activeState.category}
                onChange={(e) => patch({ category: e.target.value })}
                disabled={!metaReady || !filterOptions.categories.length}
              >
                <option value="">All aisles</option>
                {filterOptions.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </FilterSelect>

              <FilterSelect
                label="Sort"
                value={activeState.sort}
                onChange={(e) => patch({ sort: e.target.value as CatalogSort })}
              >
                {CATALOG_BAR_SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </FilterSelect>

              <FilterSelect
                label="Brand"
                value={activeState.brand}
                onChange={(e) => patch({ brand: e.target.value })}
                disabled={!metaReady || !filterOptions.brands.length}
              >
                <option value="">All brands</option>
                {filterOptions.brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </FilterSelect>

              <FilterSelect
                label="Price"
                value={activeState.maxPrice || ""}
                onChange={(e) => patch({ maxPrice: e.target.value ? Number(e.target.value) : 0 })}
              >
                <option value="">Any price</option>
                <option value="100">Under ₹100</option>
                <option value="200">Under ₹200</option>
                <option value="500">Under ₹500</option>
              </FilterSelect>

              <FilterSelect
                label="Score"
                value={activeState.minScore || ""}
                onChange={(e) => patch({ minScore: e.target.value ? Number(e.target.value) : 0 })}
              >
                <option value="">Any score</option>
                <option value="40">40+</option>
                <option value="50">50+</option>
                <option value="60">60+</option>
                <option value="70">70+</option>
              </FilterSelect>

              <FilterSelect
                label="Type"
                value={activeState.subcategory}
                onChange={(e) => patch({ subcategory: e.target.value })}
                disabled={!metaReady || !filterOptions.subcategories.length}
              >
                <option value="">All types</option>
                {filterOptions.subcategories.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </FilterSelect>

              <label className="flex items-center gap-1.5 text-[11px] text-(--color-fg-dim)">
                <input
                  type="checkbox"
                  checked={activeState.onlyScored}
                  onChange={(e) => patch({ onlyScored: e.target.checked })}
                  className="h-3.5 w-3.5 shrink-0 rounded border-(--color-line-strong) accent-(--color-fg)"
                />
                Scored only
              </label>

            {hasFilters ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {activeState.subcategory ? <FilterChip label={activeState.subcategory} onClear={() => patch({ subcategory: "" })} /> : null}
                {activeState.brand ? <FilterChip label={activeState.brand} onClear={() => patch({ brand: "" })} /> : null}
                {activeState.minScore > 0 ? <FilterChip label={`Score ${activeState.minScore}+`} onClear={() => patch({ minScore: 0 })} /> : null}
                {activeState.maxPrice > 0 ? <FilterChip label={`Under ₹${activeState.maxPrice}`} onClear={() => patch({ maxPrice: 0 })} /> : null}
                {activeState.grade ? <FilterChip label={`Grade ${activeState.grade}`} onClear={() => patch({ grade: "" })} /> : null}
                {activeState.onlyScored ? <FilterChip label="Scored only" onClear={() => patch({ onlyScored: false })} /> : null}
                {activeState.sublabel ? <FilterChip label={activeState.sublabel.replace(/_/g, " ")} onClear={() => patch({ sublabel: "" })} /> : null}
                <button type="button" onClick={clearAll} className="ml-auto text-[11px] text-(--color-fg-dim) underline-offset-4 hover:text-(--color-fg) hover:underline">
                  Clear all
                </button>
              </div>
            ) : null}
          </div>
          </div>
        )}
      </div>

      {/* ── Data-rich landing or product grid ────────────────────────── */}
      {aiSearching ? (
        <AiSearchProgress />
      ) : !aiMode && !hasFilters && !factBrowse ? (
        <ScoutLanding
          stats={stats ?? null}
          hrefQuery={productQuery}
          onFactAction={(fact) => void handleFactAction(fact)}
        />
      ) : loading && items.length === 0 ? (
        <div className="grid grid-cols-2 items-stretch gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 lg:gap-x-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex h-full animate-pulse flex-col">
              <div className="aspect-[3/4] rounded-2xl bg-(--color-bg-soft)" />
              <div className="mt-3 space-y-2 px-1">
                <div className="h-2 w-1/3 rounded bg-(--color-bg-soft)" />
                <div className="h-3.5 w-5/6 rounded bg-(--color-bg-soft)" />
                <div className="h-3.5 w-2/3 rounded bg-(--color-bg-soft)" />
                <div className="mt-1 h-4 w-1/4 rounded bg-(--color-bg-soft)" />
              </div>
            </div>
          ))}
        </div>
      ) : (aiMode ? displayedItems.length : total) === 0 ? (
        <EmptyState
          title={aiMode ? "No confirmed matches" : "No products match"}
          className="py-14"
          action={
            <button
              type="button"
              onClick={() => {
                if (aiMode) setAiPrompt("");
                clearAll();
              }}
              className="u-press rounded-full border border-(--color-line) px-5 py-2 text-sm font-medium text-(--color-fg-muted) transition hover:border-(--color-fg) hover:text-(--color-fg)"
            >
              {aiMode ? "Start over" : "Clear all filters"}
            </button>
          }
        >
          <p>
            {aiMode
              ? "We couldn’t confirm every requirement from the product information we checked. Try a more specific product name; keep any essential dietary requirements."
              : "These filters rule out the whole catalog. Remove one to widen the net:"}
          </p>
          {(!aiMode && hasFilters) ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {activeState.category ? <FilterChip label={activeState.category} onClear={() => patch({ category: "" })} /> : null}
              {activeState.subcategory ? <FilterChip label={activeState.subcategory} onClear={() => patch({ subcategory: "" })} /> : null}
              {activeState.brand ? <FilterChip label={activeState.brand} onClear={() => patch({ brand: "" })} /> : null}
              {activeState.q ? <FilterChip label={`"${activeState.q}"`} onClear={() => patch({ q: "" })} /> : null}
              {activeState.minScore > 0 ? <FilterChip label={`Score ${activeState.minScore}+`} onClear={() => patch({ minScore: 0 })} /> : null}
              {activeState.maxPrice > 0 ? <FilterChip label={`Under ₹${activeState.maxPrice}`} onClear={() => patch({ maxPrice: 0 })} /> : null}
              {activeState.grade ? <FilterChip label={`Grade ${activeState.grade}`} onClear={() => patch({ grade: "" })} /> : null}
              {activeState.verdict ? <FilterChip label={activeState.verdict.replace(/_/g, " ")} onClear={() => patch({ verdict: "" })} /> : null}
              {activeState.sublabel ? <FilterChip label={activeState.sublabel.replace(/_/g, " ")} onClear={() => patch({ sublabel: "" })} /> : null}
              {activeState.onlyScored ? <FilterChip label="Scored only" onClear={() => patch({ onlyScored: false })} /> : null}
            </div>
          ) : null}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5 md:flex-row md:gap-3">
          {/* ── LEFT PANEL: context, subcategory chips, save/search ── */}
          <aside className="w-full shrink-0 space-y-3 md:w-48 lg:w-52">
            {aiMode && aiSummary ? (
              <p className="text-[13px] leading-snug text-(--color-fg-muted)">
                {/parsed your request|closest matches/i.test(aiSummary)
                  ? aiParsed
                    ? (() => {
                        const terms = aiParsed.product_terms.join(", ") || "products";
                        const sortLabel: Record<string, string> = {
                          highest_protein: "· by protein",
                          cheapest: "· by price",
                          healthiest: "· by health score",
                          best_match: "",
                        };
                        const sort = sortLabel[aiParsed.sort_intent] ?? "";
                        return `${terms}${sort ? " " + sort : ""}`.trim();
                      })()
                    : null
                  : aiSummary}
              </p>
            ) : null}

            {(aiMode && aiSummary) || aiParsed ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {aiMode && aiSummary ? (
                  <SavedSearchActions query={aiPrompt} preferences={savedPrefs} />
                ) : null}
                {aiParsed && aiParseSource !== "cloudflare" ? (
                  <button
                    type="button"
                    title="Save diet, goals, and budget from this search"
                    onClick={() => {
                      const prefs = preferencesFromParsed(aiParsed);
                      writeAiSearchPreferences(prefs);
                      setSavedPrefs(prefs);
                    }}
                    className="text-[11px] text-(--color-fg-dim) underline decoration-(--color-line) underline-offset-2 transition hover:text-(--color-fg)"
                  >
                    Save preferences
                  </button>
                ) : null}
              </div>
            ) : null}

            {aiRelaxed ? (
              <div
                className="rounded-lg border border-(--color-line) bg-(--color-bg-soft)/60 px-3 py-2 text-left"
                style={{ borderLeft: "2px solid var(--color-accent)" }}
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-(--color-fg-muted)">
                  Why these results
                </p>
                <div className="mt-1 space-y-0.5">
                  {aiRelaxationExplanations.length > 0 ? (
                    aiRelaxationExplanations.map((step) => (
                      <p key={step} className="text-[12px] leading-snug text-(--color-fg-muted)">
                        {step}
                      </p>
                    ))
                  ) : (
                    <p className="text-[12px] leading-snug text-(--color-fg-muted)">
                      Exact matches were limited — showing closest options.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </aside>

          {/* ── RIGHT: product grid ── */}
          <div className="min-w-0 flex-1 space-y-4">
            {factBrowse ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[14px] text-(--color-fg-muted)">
                  <span className="font-semibold text-(--color-fg)">{factBrowse.total}</span> products ·{" "}
                  {factBrowse.headline}
                  {factBrowse.total > factBrowse.items.length ? (
                    <span className="text-(--color-fg-dim)"> (showing {factBrowse.items.length})</span>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFactBrowse(null);
                    setItems([]);
                    setTotal(0);
                  }}
                  className="text-[13px] text-(--color-fg-dim) underline-offset-4 hover:text-(--color-fg) hover:underline"
                >
                  Back to Scout
                </button>
              </div>
            ) : null}
            <div
              className={`grid-rise relative grid grid-cols-2 items-stretch gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 lg:gap-x-5 ${
                refreshing ? "opacity-80" : "opacity-100"
              } transition-opacity duration-100`}
            >
              {(aiMode ? displayedItems : items).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  hrefQuery={productQuery}
                  goalFit={goal !== "balanced" ? goalFits[p.id] : undefined}
                  onSublabelClick={handleSublabelClick}
                  dietaryPrevalence={dietaryPrevalence}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {aiMode ? null : hasMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore || refreshing}
            className="rounded-full border border-(--color-line) px-5 py-2 text-sm text-(--color-fg-muted) transition hover:border-(--color-fg-dim) hover:text-(--color-fg) disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : `Show more (${Math.max(0, total - items.length).toLocaleString()} left)`}
          </button>
        </div>
      ) : !aiMode && items.length > 0 && hasFilters ? (
        <p className="pt-2 text-center text-[12px] text-(--color-fg-dim)">
          All {total.toLocaleString()} result{total === 1 ? "" : "s"} shown
        </p>
      ) : null}

      {stats ? (
        <p className="text-center text-[11px] text-(--color-fg-dim)">
          {stats.scored.toLocaleString()} scored · {stats.visible.toLocaleString()} with labels
        </p>
      ) : null}
    </div>
  );
}

const AI_SEARCH_STAGES = [
  "Reading your request…",
  "Matching products…",
  "Checking nutrition against your ask…",
  "Ranking the shortlist…",
];

/** Staged progress line for AI search — cycles through pipeline stages so the
 *  1–5s wait reads as work happening, not a hang. */
function AiSearchProgress() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setStage((s) => Math.min(s + 1, AI_SEARCH_STAGES.length - 1));
    }, 1500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex min-h-[58vh] flex-col items-center justify-center gap-8 py-6">
      <div className="flex items-center justify-center gap-2.5 text-[15px] text-(--color-fg-muted)">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--color-accent) opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-(--color-accent)" />
        </span>
        <span aria-live="polite">{AI_SEARCH_STAGES[stage]}</span>
      </div>
      <SearchCats />
    </div>
  );
}

const LANDING_SECTION_COUNT = 6;

function ScoutLanding({
  stats,
  hrefQuery,
  onFactAction,
}: {
  stats: { scored: number; visible: number } | null;
  hrefQuery: string;
  onFactAction: (fact: LandingFact) => void;
}) {
  const [data, setData] = useState<LandingInsights | null>(null);
  const [loaded, setLoaded] = useState(false);
  const rotationSlot = useLandingRotationSlot();

  useEffect(() => {
    let alive = true;
    fetchLandingInsights()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const bestInClass = useMemo(
    () =>
      pickRotatingSlice(data?.bestInClass ?? [], LANDING_SECTION_COUNT, {
        slot: rotationSlot,
        slotOffset: 0,
      }),
    [data?.bestInClass, rotationSlot],
  );
  const dodgeList = useMemo(
    () =>
      pickRotatingSlice(data?.dodgeList ?? [], LANDING_SECTION_COUNT, {
        slot: rotationSlot,
        slotOffset: 1,
      }),
    [data?.dodgeList, rotationSlot],
  );
  const worthItList = useMemo(
    () =>
      pickRotatingSlice(data?.worthItList ?? [], LANDING_SECTION_COUNT, {
        slot: rotationSlot,
        slotOffset: 2,
      }),
    [data?.worthItList, rotationSlot],
  );

  if (!loaded && !data) {
    return (
      <div className="space-y-10 pt-2">
        <div className="h-48 animate-pulse rounded-2xl bg-(--color-bg-soft)" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-(--color-bg-soft)" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 pt-2">

      {/* Best in class by category */}
      {bestInClass.length > 0 && (
        <Reveal as="section">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-fg-dim)">Best in class</p>
              <h2 className="font-display mt-1 text-2xl font-semibold leading-snug text-(--color-fg) md:text-[1.65rem]">Top pick in every aisle.</h2>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bestInClass.map((cat) => (
              <div key={cat.label} className="rounded-xl border border-(--color-line) bg-(--color-panel) p-3">
                <div className="mb-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-semibold text-(--color-fg)">{cat.label}</p>
                    <div className="flex gap-2 text-[10px] text-(--color-fg-dim)">
                      <span>avg <strong className="text-(--color-fg)">{cat.avgScore}</strong></span>
                      <span className="text-(--color-bad)">· {cat.skipPct}% skip</span>
                    </div>
                  </div>
                  <Link href={cat.href} className="text-[10px] text-(--color-fg-dim) hover:text-(--color-fg)">All →</Link>
                </div>
                <div className="space-y-1.5">
                  {cat.products.map((p) => (
                    <Link
                      key={p.slug}
                      href={`/product/${p.slug}${hrefQuery}`}
                      onClick={() => saveCatalogReturnUrl(`/search${hrefQuery}`)}
                      className="group flex items-center gap-2.5 rounded-lg border border-(--color-line) bg-(--color-bg) p-2 transition hover:border-(--color-fg-muted)"
                    >
                      <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-(--color-bg-soft)">
                        {p.image && <Image src={p.image} alt={p.name} fill sizes="32px" className="object-contain p-0.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-(--color-fg) group-hover:text-(--color-accent)">{p.name}</p>
                        <div className="flex gap-1.5 text-[10px] text-(--color-fg-dim)">
                          {p.grade && <span className="font-bold text-(--color-good)">{p.grade}</span>}
                          <span>{p.score}/100</span>
                          {p.protein != null && <span>· {Math.round(p.protein)}g P</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {/* The Dodge List — marketing vs reality */}
      {dodgeList.length > 0 && (
        <Reveal as="section">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-bad)">Scout warning</p>
              <h2 className="font-display mt-1 text-2xl font-semibold leading-snug text-(--color-fg) md:text-[1.65rem]">The marketing&apos;s a lie.</h2>
            </div>
            <Link href="/search?verdict=skip&sort=score-asc" className="text-[11px] text-(--color-fg-dim) hover:text-(--color-fg)">Full skip list →</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dodgeList.map((p) => (
              <Link
                key={p.slug}
                href={`/product/${p.slug}${hrefQuery}`}
                onClick={() => saveCatalogReturnUrl(`/search${hrefQuery}`)}
                className="u-lift group rounded-xl border border-(--color-bad)/20 bg-(--color-panel) p-3 hover:border-(--color-bad)/40"
              >
                <div className="flex items-start gap-2.5">
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-(--color-bg-soft)">
                    {p.image && <Image src={p.image} alt={p.name} fill sizes="40px" className="object-contain p-0.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p.brand && <p className="truncate text-[9px] uppercase tracking-wide text-(--color-fg-dim)">{p.brand}</p>}
                    <p className="line-clamp-2 text-[12px] font-medium leading-snug text-(--color-fg) group-hover:text-(--color-accent)">{p.name}</p>
                  </div>
                  <span className="flex-shrink-0 text-base font-bold tabular-nums text-(--color-bad)">{p.score}</span>
                </div>
                <div className="mt-2.5 space-y-1">
                  <div className="flex gap-1.5 text-[11px]">
                    <span className="rounded bg-(--color-good)/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-(--color-good)">Claims</span>
                    <span className="text-(--color-fg-muted)">{p.claim}</span>
                  </div>
                  <div className="flex gap-1.5 text-[11px]">
                    <span className="rounded bg-(--color-bad)/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-(--color-bad)">Reality</span>
                    <span className="text-(--color-fg-muted)">{p.reality}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      {worthItList.length > 0 ? (
        <Reveal as="section">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-good)">Scout verified</p>
              <h2 className="font-display mt-1 text-2xl font-semibold leading-snug text-(--color-fg) md:text-[1.65rem]">
                The label checks out.
              </h2>
            </div>
            <Link
              href="/search?verdict=daily_staple&sort=score-desc"
              className="text-[11px] text-(--color-fg-dim) hover:text-(--color-fg)"
            >
              Daily staples →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {worthItList.map((p) => (
              <Link
                key={p.slug}
                href={`/product/${p.slug}${hrefQuery}`}
                onClick={() => saveCatalogReturnUrl(`/search${hrefQuery}`)}
                className="u-lift group rounded-xl border border-(--color-good)/20 bg-(--color-panel) p-3 hover:border-(--color-good)/40"
              >
                <div className="flex items-start gap-2.5">
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-(--color-bg-soft)">
                    {p.image && (
                      <Image src={p.image} alt={p.name} fill sizes="40px" className="object-contain p-0.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p.brand && (
                      <p className="truncate text-[9px] uppercase tracking-wide text-(--color-fg-dim)">{p.brand}</p>
                    )}
                    <p className="line-clamp-2 text-[12px] font-medium leading-snug text-(--color-fg) group-hover:text-(--color-accent)">
                      {p.name}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-base font-bold tabular-nums text-(--color-good)">{p.score}</span>
                </div>
                <div className="mt-2.5 space-y-1">
                  <div className="flex gap-1.5 text-[11px]">
                    <span className="rounded bg-(--color-good)/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-(--color-good)">
                      Panel
                    </span>
                    <span className="text-(--color-fg-muted)">{p.reason}</span>
                  </div>
                  {p.grade ? (
                    <div className="flex gap-1.5 text-[11px]">
                      <span className="rounded bg-(--color-bg-soft) px-1 py-0.5 text-[9px] font-semibold uppercase text-(--color-fg-dim)">
                        Grade
                      </span>
                      <span className="font-semibold text-(--color-good)">{p.grade}</span>
                    </div>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      ) : null}

      {stats ? (
        <p className="pt-2 text-center text-[12px] text-(--color-fg-dim)">
          Scout has read the label on every one of {stats.scored.toLocaleString()} scored products.
        </p>
      ) : null}
    </div>
  );
}
