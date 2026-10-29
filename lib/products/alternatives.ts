import { canScoreReviewedNutrition } from "@/lib/nutrition/review";
import { computeGoalFit, goalFitInputs } from "@/lib/goals/fit";
import type { GoalId } from "@/lib/goals/types";
import { isDietCompatible } from "@/lib/diet/match";
import type { DietMode } from "@/lib/diet/types";
import {
  productAisle,
  productShelf,
  productUsecase,
  sameProductUsecase,
} from "@/lib/products/catalog-meta";
import type { ProductListItem } from "@/lib/products/queries";
import type { ProductNutrition } from "@/lib/supabase/types";

export type SwapSuggestion = {
  product: ProductListItem;
  goalFit: number;
  deltas: string[];
};

export type SimilarProductSuggestion = SwapSuggestion;

function sugar(n: ProductNutrition | null): number | null {
  const s = n?.sugar_g_100g ?? n?.added_sugar_g_100g;
  return typeof s === "number" ? s : null;
}

function priceBand(price: number | null): number | null {
  if (price == null || price <= 0) return null;
  if (price < 80) return 1;
  if (price < 200) return 2;
  if (price < 400) return 3;
  return 4;
}

function brandKey(p: ProductListItem): string {
  const b = p.brand?.trim().toLowerCase();
  if (b) return b;
  const first = p.name.split(/\s+/)[0]?.toLowerCase() ?? "";
  return first.length >= 3 ? first : p.name.slice(0, 12).toLowerCase();
}

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !SIMILAR_STOPWORDS.has(t)),
  );
}

const SIMILAR_STOPWORDS = new Set([
  "and",
  "with",
  "the",
  "pack",
  "combo",
  "free",
  "fresh",
  "classic",
  "premium",
]);

const FLAVOUR_TOKENS = new Set([
  "almond",
  "blueberry",
  "butterscotch",
  "caramel",
  "cheese",
  "chilli",
  "chocolate",
  "coffee",
  "cream",
  "dark",
  "elaichi",
  "fruit",
  "garlic",
  "hazelnut",
  "jeera",
  "mango",
  "mint",
  "orange",
  "paneer",
  "pista",
  "pistachio",
  "rose",
  "strawberry",
  "vanilla",
]);

function nameOverlap(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

function tokenIntersection(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const token of a) {
    if (b.has(token)) out.push(token);
  }
  return out;
}

function flavourOverlap(a: string, b: string): string[] {
  const shared = tokenIntersection(nameTokens(a), nameTokens(b));
  return shared.filter((token) => FLAVOUR_TOKENS.has(token));
}

function additiveCount(raw: string | null | undefined): number {
  if (!raw?.trim()) return 0;
  const text = raw.toLowerCase();
  const patterns = [
    /\bins\s*\d{3,4}[a-z]?\b/g,
    /\be\s*\d{3,4}[a-z]?\b/g,
    /artificial/g,
    /colour|color/g,
    /emulsif/g,
    /flavour|flavor/g,
    /preservative/g,
    /stabili[sz]er/g,
    /acidity regulator/g,
    /raising agent/g,
    /antioxidant/g,
  ];
  return patterns.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
}

function nutritionTooSimilar(
  a: ProductNutrition | null,
  b: ProductNutrition | null,
): boolean {
  if (!a || !b) return false;
  const pairs: [number | null | undefined, number | null | undefined][] = [
    [a.protein_g_100g, b.protein_g_100g],
    [a.sugar_g_100g ?? a.added_sugar_g_100g, b.sugar_g_100g ?? b.added_sugar_g_100g],
    [a.fiber_g_100g, b.fiber_g_100g],
    [a.energy_kcal_100g, b.energy_kcal_100g],
  ];
  let compared = 0;
  let close = 0;
  for (const [x, y] of pairs) {
    if (typeof x !== "number" || typeof y !== "number") continue;
    compared++;
    if (Math.abs(x - y) < 1.5) close++;
  }
  return compared >= 2 && close === compared;
}

function shelfRelated(current: ProductListItem, candidate: ProductListItem): boolean {
  const curSub = current.subcategory?.trim().toLowerCase() ?? "";
  const candSub = candidate.subcategory?.trim().toLowerCase() ?? "";
  if (curSub && candSub) {
    return curSub === candSub;
  }
  const curShelf = productShelf(current)?.toLowerCase() ?? "";
  const candShelf = productShelf(candidate)?.toLowerCase() ?? "";
  if (curShelf && candShelf) {
    if (curShelf === candShelf) return true;
    if (curShelf.includes(candShelf) || candShelf.includes(curShelf)) return true;
  }
  return nameOverlap(current.name, candidate.name) >= 0.35;
}

function buildDeltas(
  current: ProductListItem,
  p: ProductListItem,
): string[] {
  const deltas: string[] = [];
  const curSugar = sugar(current.nutrition);
  const pSugar = sugar(p.nutrition);
  const curProtein = current.nutrition?.protein_g_100g ?? null;
  const pProtein = p.nutrition?.protein_g_100g ?? null;
  const curFiber = current.nutrition?.fiber_g_100g ?? null;
  const pFiber = p.nutrition?.fiber_g_100g ?? null;
  const curKcal = current.nutrition?.energy_kcal_100g ?? null;
  const pKcal = p.nutrition?.energy_kcal_100g ?? null;

  if (curSugar != null && pSugar != null && pSugar < curSugar - 0.8) {
    deltas.push(`−${(curSugar - pSugar).toFixed(1)}g sugar`);
  }
  if (curProtein != null && pProtein != null && pProtein > curProtein + 1.5) {
    deltas.push(`+${(pProtein - curProtein).toFixed(1)}g protein`);
  }
  if (curFiber != null && pFiber != null && pFiber > curFiber + 1) {
    deltas.push(`+${(pFiber - curFiber).toFixed(1)}g fibre`);
  }
  if (curKcal != null && pKcal != null && pKcal < curKcal - 15) {
    deltas.push(`−${Math.round(curKcal - pKcal)} kcal`);
  }
  if (p.brand && p.brand !== current.brand) {
    deltas.push(p.brand);
  }
  if (p.core_scores && current.core_scores) {
    const diff = p.core_scores.score - current.core_scores.score;
    if (diff >= 5) deltas.push(`Core +${diff}`);
    else if (deltas.length === 0) deltas.push(`Core ${p.core_scores.score}`);
  } else if (deltas.length === 0 && p.core_scores) {
    deltas.push(`Core ${p.core_scores.score}`);
  }
  if (p.price_inr != null && current.price_inr != null) {
    const diff = p.price_inr - current.price_inr;
    if (Math.abs(diff) <= Math.max(40, current.price_inr * 0.4)) {
      deltas.push(diff <= 0 ? `₹${p.price_inr} (−${Math.abs(diff)})` : `₹${p.price_inr}`);
    }
  }
  return deltas.slice(0, 3);
}

function candidateScore(
  current: ProductListItem,
  p: ProductListItem,
  goal: GoalId,
  rank: number,
  curRank: number,
): number {
  let s = rank - curRank;

  if (brandKey(p) !== brandKey(current)) s += 12;
  else s -= 25;

  if (shelfRelated(current, p)) s += 10;
  if (productShelf(current) && productShelf(p) === productShelf(current)) s += 6;

  const curSugar = sugar(current.nutrition);
  const pSugar = sugar(p.nutrition);
  if (curSugar != null && pSugar != null && curSugar > 8 && pSugar < curSugar) {
    s += (curSugar - pSugar) * 2;
  }

  const curProtein = current.nutrition?.protein_g_100g ?? 0;
  const pProtein = p.nutrition?.protein_g_100g ?? 0;
  if (curProtein < 12 && pProtein > curProtein) s += (pProtein - curProtein) * 1.2;

  if (nutritionTooSimilar(current.nutrition, p.nutrition)) s -= 30;

  const band = priceBand(current.price_inr);
  const pBand = priceBand(p.price_inr);
  if (band != null && pBand != null && Math.abs(pBand - band) <= 1) s += 4;

  if (nameOverlap(current.name, p.name) > 0.55) s -= 8;

  return s;
}

export function findAlternatives(
  current: ProductListItem,
  catalog: ProductListItem[],
  goal: GoalId,
  limit = 3,
  opts?: { diet?: DietMode },
): SwapSuggestion[] {
  if (!canScoreReviewedNutrition(current)) return [];
  const aisle = productAisle(current);
  const diet: DietMode = opts?.diet ?? "any";
  const curRank =
    goal === "balanced"
      ? (current.core_scores?.score ?? -1)
      : computeGoalFit(goal, goalFitInputs(current)).fit;
  const minImprovement = goal === "balanced" ? 5 : 4;
  const band = priceBand(current.price_inr);
  const curBrand = brandKey(current);

  const anchorL3 = productUsecase(current);

  const pool = catalog.filter((p) => {
    if (!canScoreReviewedNutrition(p)) return false;
    if (p.id === current.id) return false;
    if (!p.core_scores && goal === "balanced") return false;
    if (anchorL3) {
      if (!sameProductUsecase(current, p)) return false;
    } else {
      if (aisle && productAisle(p) !== aisle) return false;
      if (
        current.subcategory?.trim() &&
        p.subcategory?.trim() &&
        p.subcategory.trim().toLowerCase() !== current.subcategory.trim().toLowerCase()
      ) {
        return false;
      }
    }
    if (!shelfRelated(current, p)) return false;
    if (nutritionTooSimilar(current.nutrition, p.nutrition)) return false;
    if (brandKey(p) === curBrand && nameOverlap(current.name, p.name) > 0.4) return false;
    if (!isDietCompatible(diet, p).ok) return false;
    return true;
  });

  const candidates = pool
    .map((p) => {
      const goalFit = computeGoalFit(goal, goalFitInputs(p)).fit;
      const rank = goal === "balanced" ? (p.core_scores?.score ?? -1) : goalFit;
      return { p, goalFit, rank, pick: candidateScore(current, p, goal, rank, curRank) };
    })
    .filter(({ rank }) => rank >= curRank + minImprovement)
    .filter(({ p }) => {
      if (band == null || priceBand(p.price_inr) == null) return true;
      return Math.abs(priceBand(p.price_inr)! - band) <= 1;
    })
    .sort((a, b) => b.pick - a.pick);

  const picked: SwapSuggestion[] = [];
  const usedBrands = new Set<string>([curBrand]);

  for (const { p, goalFit } of candidates) {
    const b = brandKey(p);
    if (usedBrands.has(b)) continue;
    if (picked.some((x) => nameOverlap(x.product.name, p.name) > 0.5)) continue;

    picked.push({
      product: p,
      goalFit,
      deltas: buildDeltas(current, p),
    });
    usedBrands.add(b);
    if (picked.length >= limit) break;
  }

  if (picked.length < limit) {
    for (const { p, goalFit } of candidates) {
      if (picked.some((x) => x.product.id === p.id)) continue;
      const b = brandKey(p);
      if (picked.filter((x) => brandKey(x.product) === b).length >= 1) continue;
      picked.push({
        product: p,
        goalFit,
        deltas: buildDeltas(current, p),
      });
      if (picked.length >= limit) break;
    }
  }

  return picked;
}

function similarityScore(current: ProductListItem, p: ProductListItem): number {
  const curTokens = nameTokens(current.name);
  const candTokens = nameTokens(p.name);
  const shared = tokenIntersection(curTokens, candTokens);
  const flavours = shared.filter((token) => FLAVOUR_TOKENS.has(token));
  let score = 0;

  if (current.brand && p.brand && current.brand === p.brand) score += 18;
  if (current.subcategory && p.subcategory === current.subcategory) score += 14;
  if (productShelf(current) && productShelf(p) === productShelf(current)) score += 8;
  score += nameOverlap(current.name, p.name) * 34;
  score += Math.min(20, flavours.length * 10);

  if (current.price_inr != null && p.price_inr != null) {
    const denom = Math.max(current.price_inr, p.price_inr, 1);
    score += Math.max(0, 16 * (1 - Math.abs(current.price_inr - p.price_inr) / denom));
  }
  if (current.core_scores?.score != null && p.core_scores?.score != null) {
    score += Math.max(0, 16 * (1 - Math.abs(current.core_scores.score - p.core_scores.score) / 40));
  }
  return score;
}

function buildSimilarityReasons(current: ProductListItem, p: ProductListItem): string[] {
  const reasons: string[] = [];
  const curSugar = sugar(current.nutrition);
  const pSugar = sugar(p.nutrition);
  const curCarbs = current.nutrition?.carbs_g_100g ?? null;
  const pCarbs = p.nutrition?.carbs_g_100g ?? null;
  const curProtein = current.nutrition?.protein_g_100g ?? null;
  const pProtein = p.nutrition?.protein_g_100g ?? null;
  const curKcal = current.nutrition?.energy_kcal_100g ?? null;
  const pKcal = p.nutrition?.energy_kcal_100g ?? null;
  const curSat = current.nutrition?.saturated_fat_g_100g ?? null;
  const pSat = p.nutrition?.saturated_fat_g_100g ?? null;
  const curSodium = current.nutrition?.sodium_mg_100g ?? null;
  const pSodium = p.nutrition?.sodium_mg_100g ?? null;
  const curAdditives = additiveCount(current.ingredients_raw);
  const pAdditives = additiveCount(p.ingredients_raw);

  if (curSugar != null && pSugar != null && pSugar <= curSugar - 1) {
    reasons.push(`−${(curSugar - pSugar).toFixed(1)}g sugar`);
  }
  if (curCarbs != null && pCarbs != null && pCarbs <= curCarbs - 5) {
    reasons.push(`−${Math.round(curCarbs - pCarbs)}g carbs`);
  }
  if (curKcal != null && pKcal != null && pKcal <= curKcal - 25) {
    reasons.push(`−${Math.round(curKcal - pKcal)} kcal`);
  }
  if (curProtein != null && pProtein != null && pProtein >= curProtein + 1.5) {
    reasons.push(`+${(pProtein - curProtein).toFixed(1)}g protein`);
  }
  if (curSat != null && pSat != null && pSat <= curSat - 1) {
    reasons.push(`−${(curSat - pSat).toFixed(1)}g sat fat`);
  }
  if (curSodium != null && pSodium != null && pSodium <= curSodium - 80) {
    reasons.push(`−${Math.round(curSodium - pSodium)}mg sodium`);
  }
  // Only flag clean ingredients if the current product is NOT clean — makes it a real differentiator
  if (curAdditives > 0 && pAdditives === 0 && p.ingredients_raw?.trim()) {
    reasons.push("Cleaner ingredients");
  } else if (curAdditives > 1 && pAdditives < curAdditives) {
    reasons.push(`${curAdditives - pAdditives} fewer additives`);
  }
  if (p.core_scores?.score != null && current.core_scores?.score != null) {
    const diff = p.core_scores.score - current.core_scores.score;
    if (diff >= 4) reasons.push(`Score +${diff}`);
  }
  // Fallback: ingredient count is more concrete than a bare score
  if (!reasons.length) {
    const ingCount = p.ingredients_raw?.split(",").filter(Boolean).length;
    if (ingCount) reasons.push(`${ingCount} ingredients`);
    else if (p.core_scores?.score != null) reasons.push(`Score ${p.core_scores.score}`);
  }
  return reasons.slice(0, 3);
}

export function findSimilarProducts(
  current: ProductListItem,
  catalog: ProductListItem[],
  goal: GoalId,
  limit = 4,
  opts?: { diet?: DietMode; excludeIds?: Set<string> },
): SimilarProductSuggestion[] {
  const diet: DietMode = opts?.diet ?? "any";
  const excludeIds = opts?.excludeIds ?? new Set<string>();
  const anchorL3 = productUsecase(current);

  const candidates = catalog
    .filter(canScoreReviewedNutrition)
    .filter((p) => p.id !== current.id && !excludeIds.has(p.id))
    .filter((p) => (anchorL3 ? sameProductUsecase(current, p) : true))
    .filter((p) => isDietCompatible(diet, p).ok)
    .map((p) => ({
      p,
      score: similarityScore(current, p),
      goalFit: computeGoalFit(goal, goalFitInputs(p)).fit,
    }))
    .filter(({ score }) => score >= 18)
    .sort((a, b) => b.score - a.score);

  const picked: SimilarProductSuggestion[] = [];
  const brandCounts = new Map<string, number>();
  for (const { p, goalFit } of candidates) {
    const brand = brandKey(p);
    if ((brandCounts.get(brand) ?? 0) >= 4) continue;
    picked.push({
      product: p,
      goalFit,
      deltas: buildSimilarityReasons(current, p),
    });
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
    if (picked.length >= limit) break;
  }
  return picked;
}
