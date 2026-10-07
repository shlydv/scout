import type { CatalogFilterState } from "@/lib/products/catalog-filter";
import type { GoalId } from "@/lib/goals/types";
import type { DietMode } from "@/lib/diet/types";
import type { CatalogGridItem } from "@/lib/products/catalog-api";
import type { ParsedProductQuery } from "@/lib/search/query-parse";
import type { ProductListItem } from "@/lib/products/queries";
export const CATALOG_SNAPSHOT_KEY = "scout-catalog-snapshot";
export const CATALOG_SNAPSHOT_VERSION = 2;

export type CatalogFactBrowseSnapshot = {
  headline: string;
  items: ProductListItem[];
  total: number;
};

export type CatalogSearchSnapshot = {
  version: typeof CATALOG_SNAPSHOT_VERSION;
  href: string;
  state: CatalogFilterState;
  goal: GoalId;
  diet: DietMode;
  items: CatalogGridItem[];
  goalFits: Record<string, number>;
  total: number;
  page: number;
  hasMore: boolean;
  aiMode: boolean;
  aiPrompt: string;
  aiSummary: string | null;
  aiParseSource: "deepseek" | "heuristic" | "cloudflare" | null;
  aiRankSource: string | null;
  aiIntentTier: string | null;
  aiRelaxed: boolean;
  aiWarning: string | null;
  aiRefinements: string[];
  aiRelaxationExplanations: string[];
  aiParsed: ParsedProductQuery | null;
  factBrowse: CatalogFactBrowseSnapshot | null;
};

let pendingSnapshot: CatalogSearchSnapshot | null = null;

export function registerCatalogSnapshot(snapshot: CatalogSearchSnapshot | null): void {
  pendingSnapshot = snapshot;
}

export function readCatalogSnapshot(): CatalogSearchSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CATALOG_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogSearchSnapshot;
    if (parsed.version !== CATALOG_SNAPSHOT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCatalogSnapshot(snapshot: CatalogSearchSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CATALOG_SNAPSHOT_KEY, JSON.stringify(snapshot));
    pendingSnapshot = snapshot;
  } catch {
    /* quota or private mode */
  }
}

export function clearCatalogSnapshot(): void {
  pendingSnapshot = null;
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CATALOG_SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

/** Persist the latest in-memory snapshot when navigating to PDP. */
export function flushCatalogSnapshotForNavigation(href: string): void {
  if (typeof window === "undefined") return;
  const snap = pendingSnapshot ?? readCatalogSnapshot();
  if (!snap) return;
  try {
    sessionStorage.setItem(
      CATALOG_SNAPSHOT_KEY,
      JSON.stringify({ ...snap, href }),
    );
  } catch {
    /* ignore */
  }
}

function normalizeSearchHref(href: string): string {
  if (!href.startsWith("/search")) return href;
  try {
    const u = new URL(href, "https://local");
    const keys = [...u.searchParams.keys()].sort();
    const p = new URLSearchParams();
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v != null) p.set(k, v);
    }
    const q = p.toString();
    return q ? `/search?${q}` : "/search";
  } catch {
    return href;
  }
}

/** Restore grid/AI state when the saved return URL matches the current catalog URL. */
export function catalogSnapshotForHref(currentHref: string): CatalogSearchSnapshot | null {
  const snap = readCatalogSnapshot();
  if (!snap) return null;
  const current = normalizeSearchHref(currentHref);
  const saved = normalizeSearchHref(snap.href);
  if (current === saved) return snap;

  try {
    const returnHref = sessionStorage.getItem("scout-catalog-return");
    if (returnHref && normalizeSearchHref(returnHref) === saved) return snap;
  } catch {
    /* ignore */
  }
  return null;
}

export function isCatalogResultsView(snap: CatalogSearchSnapshot): boolean {
  // A "results view" is one where the user actively did something — ran an AI search,
  // applied a filter, or typed a query. Items alone don't count: the default catalog
  // always has items, and restoring that over ScoutLanding is the wrong behaviour.
  return (
    snap.aiMode ||
    snap.factBrowse != null ||
    Boolean(snap.state.q?.trim()) ||
    Boolean(snap.state.category) ||
    Boolean(snap.state.subcategory) ||
    Boolean(snap.state.usecase) ||
    Boolean(snap.state.brand) ||
    snap.state.onlyScored ||
    snap.state.onlyLabelResolved ||
    snap.state.onlyDeepseek ||
    snap.state.minScore > 0 ||
    snap.state.maxPrice > 0 ||
    Boolean(snap.state.grade) ||
    Boolean(snap.state.sublabel) ||
    Boolean(snap.state.verdict) ||
    snap.state.sort !== "score-desc"
  );
}
