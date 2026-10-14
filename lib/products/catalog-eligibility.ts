import { isBlockedTaxonomy } from "@/lib/catalog/policy";
import { isPackagedProduceLike, isFreshWholeProduce } from "@/lib/catalog/packaged-produce";
import { FRUITS_VEGETABLES_AISLE } from "@/lib/products/catalog-meta";
import {
  isPlatformNutritionComplete,
  isReferenceProduceNutritionComplete,
} from "@/lib/nutrition/completeness";
import type { ProductNutrition } from "@/lib/supabase/types";

export type CatalogEligibilityRow = {
  platform?: string | null;
  zepto_sku?: string | null;
  name: string;
  super_category?: string | null;
  category?: string | null;
  subcategory?: string | null;
  ingredients_raw?: string | null;
  nutrition?: ProductNutrition | null;
};

/** Food products with label-grade nutrition — excludes non-food and rows still pending nutrition.
 *  Where a product came from never matters, so products added later are judged the same way. */
export function isCatalogVisible(p: CatalogEligibilityRow): boolean {
  if (
    isBlockedTaxonomy({
      super_category: p.super_category,
      category: p.category,
      subcategory: p.subcategory,
      name: p.name,
    })
  ) {
    return false;
  }

  // Fruits & vegetables aisle — show whole produce even before reference/OCR fill.
  if (p.category?.trim() === FRUITS_VEGETABLES_AISLE) {
    if (isPackagedProduceLike(p.name, p.subcategory)) return false;
    return true;
  }

  const freshProduce = isFreshWholeProduce({
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
  });
  if (freshProduce && isReferenceProduceNutritionComplete(p.nutrition ?? null)) {
    return true;
  }

  return isPlatformNutritionComplete(p.ingredients_raw ?? null, p.nutrition ?? null);
}

export function computeCatalogVisible(p: CatalogEligibilityRow): boolean {
  return isCatalogVisible(p);
}
