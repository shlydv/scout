import { isDietCompatible } from "@/lib/diet/match";
import type { DietMode } from "@/lib/diet/types";
import { dietFromParam } from "@/lib/diet/types";
import { goalFromParam } from "@/lib/goals/types";
import {
  productAisle,
  productMatchesAisle,
  productMatchesShelf,
  productMatchesUsecase,
  productShelf,
  productUsecase,
} from "@/lib/products/catalog-meta";
import { sortFromParam, type CatalogSort } from "@/lib/products/catalog-sort";
import {
  productHasDeepseekLabel,
  productHasLabelValueChange,
} from "@/lib/products/label-resolution";
import type { CatalogFilters, ProductListItem } from "@/lib/products/queries";
import type { Grade } from "@/lib/supabase/types";

export type CatalogFilterState = {
  q: string;
  category: string;
  subcategory: string;
  usecase: string;
  brand: string;
  onlyScored: boolean;
  /** Products where label read disagreed with Zepto CSV (nutrition or ingredients). */
  onlyLabelResolved: boolean;
  /** Products with a promoted DeepSeek label extraction. */
  onlyDeepseek: boolean;
  minScore: number;
  maxPrice: number;
  grade: Grade | "";
  sort: CatalogSort;
  /** Filter by a persisted sublabel chip id e.g. "high_in_protein" */
  sublabel: string;
  /** Filter by persisted verdict e.g. "daily_staple" */
  verdict: string;
};

/** True when SQL count must reflect filters — otherwise meta.stats.scored is enough. */
export function hasActiveCatalogFilters(
  state: CatalogFilterState,
  diet: DietMode = "any",
): boolean {
  return Boolean(
    state.q.trim() ||
      state.category ||
      state.subcategory ||
      state.usecase ||
      state.brand ||
      state.onlyScored ||
      state.onlyLabelResolved ||
      state.onlyDeepseek ||
      state.minScore > 0 ||
      state.maxPrice > 0 ||
      state.grade ||
      state.sublabel ||
      state.verdict ||
      diet !== "any",
  );
}

export function filterCatalogProducts(
  products: ProductListItem[],
  state: CatalogFilterState,
  diet: DietMode = "any",
): ProductListItem[] {
  const q = state.q.trim().toLowerCase();

  return products.filter((p) => {
    if (state.onlyLabelResolved && !productHasLabelValueChange(p.ocr_payload)) return false;
    if (state.onlyDeepseek && !productHasDeepseekLabel(p.ocr_payload)) return false;
    if (state.onlyScored && !p.core_scores) return false;
    if (state.minScore > 0) {
      const s = p.core_scores?.score;
      if (s == null || s < state.minScore) return false;
    }
    if (state.maxPrice > 0) {
      const price = p.price_inr ?? p.mrp_inr;
      if (price == null || price > state.maxPrice) return false;
    }
    if (state.grade && p.core_scores?.grade !== state.grade) return false;
    if (!productMatchesAisle(p, state.category)) return false;
    if (!productMatchesShelf(p, state.subcategory)) return false;
    if (!productMatchesUsecase(p, state.usecase)) return false;
    if (state.brand && p.brand !== state.brand) return false;
    if (diet !== "any" && !isDietCompatible(diet, p).ok) return false;
    if (!q) return true;
    const shelf = productShelf(p);
    const usecase = productUsecase(p);
    const hay = [p.name, p.brand, productAisle(p), shelf, usecase]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
