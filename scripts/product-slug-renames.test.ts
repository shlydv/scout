/** Basket and compare entries saved under old slugs move to the product's current slug. */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readBasket, renameBasketSlugs, writeBasket } from "@/lib/basket/storage";
import { readCompare, renameCompareSlugs } from "@/lib/compare/storage";
import { slugRenames } from "@/lib/products/slug-renames";

const store = new Map<string, string>();
const events: string[] = [];
const win = new EventTarget();
win.addEventListener("scout-basket", () => events.push("scout-basket"));
win.addEventListener("scout-compare", () => events.push("scout-compare"));
Object.defineProperty(globalThis, "window", { value: win, configurable: true });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

beforeEach(() => {
  store.clear();
  events.length = 0;
});

test("slugRenames maps every old slug to the product's current slug", () => {
  const renames = slugRenames([
    { slug: "amul-butter-1", renamed_from: ["x-amul-butter-1", "amul-butter-old-1"] },
    { slug: "plain-2" },
  ]);
  assert.deepEqual([...renames], [["x-amul-butter-1", "amul-butter-1"], ["amul-butter-old-1", "amul-butter-1"]]);
});

test("basket lines move to the current slug and merge with a line already there", () => {
  writeBasket([
    { slug: "x-a-1", name: "A", qty: 2, addedAt: 1, shoppingContexts: ["ctx-1", "ctx-2"] },
    { slug: "b-2", name: "B", qty: 1, addedAt: 2 },
    { slug: "a-1", name: "A", qty: 1, addedAt: 3, shoppingContexts: ["ctx-2", "ctx-3"] },
    { slug: "x-c-3", name: "C", qty: 1, addedAt: 4 },
    { slug: "c-3", name: "C", qty: 1, addedAt: 5 },
  ]);
  renameBasketSlugs(new Map([["x-a-1", "a-1"], ["x-c-3", "c-3"]]));
  assert.deepEqual(
    readBasket().map((e) => [e.slug, e.qty, e.shoppingContexts]),
    [["a-1", 3, ["ctx-1", "ctx-2", "ctx-3"]], ["b-2", 1, undefined], ["c-3", 2, undefined]],
  );
  assert.deepEqual(events, ["scout-basket"]);
});

test("basket is left alone when no line uses an old slug", () => {
  writeBasket([{ slug: "b-2", name: "B", qty: 1, addedAt: 2 }]);
  const before = store.get("scout-basket-v1");
  renameBasketSlugs(new Map([["x-a-1", "a-1"]]));
  assert.equal(store.get("scout-basket-v1"), before);
  assert.deepEqual(events, []);
});

test("compare entries keep tray order, drop a duplicate and keep a shopping context", () => {
  store.set(
    "scout-compare-v1",
    JSON.stringify([
      { slug: "x-a-1", name: "A", image: null, addedAt: 1 },
      { slug: "c-3", name: "C", image: null, addedAt: 2, shoppingContext: "ctx-c" },
      { slug: "a-1", name: "A", image: null, addedAt: 3, shoppingContext: "ctx-a" },
      { slug: "x-c-3", name: "C", image: null, addedAt: 4, shoppingContext: "ctx-other" },
    ]),
  );
  renameCompareSlugs(new Map([["x-a-1", "a-1"], ["x-c-3", "c-3"]]));
  assert.deepEqual(readCompare().map((e) => [e.slug, e.shoppingContext]), [["a-1", "ctx-a"], ["c-3", "ctx-c"]]);
  assert.deepEqual(events, ["scout-compare"]);
});
