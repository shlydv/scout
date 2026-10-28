export type BasketEntry = {
  shoppingContexts?: string[];
  slug: string;
  name: string;
  qty: number;
  addedAt: number;
};

const KEY = "scout-basket-v1";
const LEGACY_KEY = "oasis-basket-v1";
const EVENT = "scout-basket";

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  const current = localStorage.getItem(KEY);
  if (current != null) return current;
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy != null) {
    localStorage.setItem(KEY, legacy);
    return legacy;
  }
  return null;
}

function dispatchBasket(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function readBasket(): BasketEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readRaw();
    if (!raw) return [];
    return JSON.parse(raw) as BasketEntry[];
  } catch {
    return [];
  }
}

export function writeBasket(entries: BasketEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries));
}

export function addToBasket(slug: string, name: string, shoppingContext?: string): BasketEntry[] {
  const list = readBasket();
  const existing = list.find((e) => e.slug === slug);
  if (existing) {
    existing.qty += 1;
    if (shoppingContext) existing.shoppingContexts = [...new Set([...(existing.shoppingContexts ?? []), shoppingContext])];
  } else list.push({ slug, name, qty: 1, addedAt: Date.now(), shoppingContexts: shoppingContext ? [shoppingContext] : undefined });
  writeBasket(list);
  dispatchBasket();
  return list;
}

export function removeFromBasket(slug: string): BasketEntry[] {
  const list = readBasket().filter((e) => e.slug !== slug);
  writeBasket(list);
  dispatchBasket();
  return list;
}

/** Replace one cart line with a swap — keeps quantity. */
export function replaceInBasket(fromSlug: string, toSlug: string, toName: string): BasketEntry[] {
  const list = readBasket();
  const entry = list.find((e) => e.slug === fromSlug);
  if (!entry) return list;
  const existingTarget = list.find((e) => e.slug === toSlug);
  if (existingTarget && existingTarget !== entry) {
    existingTarget.qty += entry.qty;
    existingTarget.shoppingContexts = [...new Set([...(existingTarget.shoppingContexts ?? []), ...(entry.shoppingContexts ?? [])])];
    const next = list.filter((e) => e.slug !== fromSlug);
    writeBasket(next);
    dispatchBasket();
    return next;
  }
  entry.slug = toSlug;
  entry.name = toName;
  entry.addedAt = Date.now();
  writeBasket(list);
  dispatchBasket();
  return list;
}

export function decrementBasket(slug: string): BasketEntry[] {
  const list = readBasket();
  const entry = list.find((e) => e.slug === slug);
  if (!entry) return list;
  if (entry.qty <= 1) return removeFromBasket(slug);
  entry.qty -= 1;
  writeBasket(list);
  dispatchBasket();
  return list;
}

export function clearBasket(): void {
  writeBasket([]);
  dispatchBasket();
}

export function basketCount(): number {
  return readBasket().reduce((n, e) => n + e.qty, 0);
}
