export type CompareEntry = {
  shoppingContext?: string;
  slug: string;
  name: string;
  image: string | null;
  addedAt: number;
};

const KEY = "scout-compare-v1";
const EVENT = "scout-compare";

/** Side-by-side comparison works best with a handful of products. */
export const COMPARE_LIMIT = 4;

function dispatchCompare(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function readCompare(): CompareEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CompareEntry[];
  } catch {
    return [];
  }
}

function writeCompare(entries: CompareEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, COMPARE_LIMIT)));
  dispatchCompare();
}

export function isInCompare(slug: string): boolean {
  return readCompare().some((e) => e.slug === slug);
}

/** Returns true if added, false when the tray is already full. */
export function addToCompare(entry: Omit<CompareEntry, "addedAt">): boolean {
  const list = readCompare();
  if (list.some((e) => e.slug === entry.slug)) return true;
  if (list.length >= COMPARE_LIMIT) return false;
  writeCompare([...list, { ...entry, addedAt: Date.now() }]);
  return true;
}

export function removeFromCompare(slug: string): void {
  writeCompare(readCompare().filter((e) => e.slug !== slug));
}

/** Returns true when the intended action succeeded; false only when an *add* was
 *  blocked by a full tray. Removing is always a success. */
export function toggleCompare(entry: Omit<CompareEntry, "addedAt">): boolean {
  if (isInCompare(entry.slug)) {
    removeFromCompare(entry.slug);
    return true;
  }
  return addToCompare(entry);
}

export function clearCompare(): void {
  writeCompare([]);
}

export const COMPARE_EVENT = EVENT;
