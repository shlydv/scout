import { isFreshWholeProduce } from "@/lib/catalog/packaged-produce";
import { hasReferenceNutrition } from "@/lib/nutrition/completeness";
import type { ProductListItem } from "@/lib/products/queries";

export const FRUITS_VEGETABLES_AISLE = "Fruits & Vegetables";

/** L1 aisle (category). */
export function productAisle(p: Pick<ProductListItem, "category" | "super_category">): string | null {
  return p.category ?? p.super_category ?? null;
}

/** L2 type (subcategory). */
export function productShelf(
  p: Pick<ProductListItem, "subcategory" | "attributes">,
): string | null {
  if (p.subcategory?.trim()) return p.subcategory.trim();
  return null;
}

/** L3 use-case (stored in attributes when column absent). */
export function productUsecase(
  p: Pick<ProductListItem, "l3_category" | "attributes">,
): string | null {
  if (p.l3_category?.trim()) return p.l3_category.trim();
  const v = p.attributes?.["L3 Category"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function productMatchesUsecase(
  p: Pick<ProductListItem, "l3_category" | "attributes">,
  usecase: string,
): boolean {
  if (!usecase) return true;
  const target = usecase.trim();
  const actual = productUsecase(p);
  return Boolean(actual && actual === target);
}

/** PDP swaps / similar rows must share Zepto L3 use-case when the anchor product has one. */
export function sameProductUsecase(
  a: Pick<ProductListItem, "l3_category" | "attributes">,
  b: Pick<ProductListItem, "l3_category" | "attributes">,
): boolean {
  const ua = productUsecase(a);
  if (!ua) return true;
  return productMatchesUsecase(b, ua);
}

export function isFruitsVegetablesAisle(
  p: Pick<ProductListItem, "category" | "super_category">,
): boolean {
  const aisle = productAisle(p);
  return aisle?.trim() === FRUITS_VEGETABLES_AISLE;
}

export function productMatchesAisle(
  p: Pick<ProductListItem, "category" | "super_category" | "subcategory" | "name" | "nutrition">,
  aisle: string,
): boolean {
  if (!aisle) return true;
  if (aisle === FRUITS_VEGETABLES_AISLE) {
    // Primary: the category is already "Fruits & Vegetables".
    if (isFruitsVegetablesAisle(p)) return true;
    return (
      hasReferenceNutrition(p.nutrition ?? null) ||
      isFreshWholeProduce({
        name: p.name,
        category: p.category,
        subcategory: p.subcategory,
      })
    );
  }
  return productAisle(p) === aisle;
}

export function productMatchesShelf(
  p: Pick<ProductListItem, "subcategory" | "attributes">,
  shelf: string,
): boolean {
  if (!shelf) return true;
  return productShelf(p) === shelf;
}
