import { GOAL_PROFILES, type GoalId } from "@/lib/goals/types";
import { buildInsights, type InsightLists } from "@/lib/products/insights";
import type { ProductListItem } from "@/lib/products/queries";
import type { ProductNutrition } from "@/lib/supabase/types";

export type LandingPick = {
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  score: number | null;
  grade: string | null;
  verdict: string | null;
  price: number | null;
  meta: string | null;
};

export type LandingFactAction =
  | { type: "expose"; slugs: string[] }
  | { type: "catalog"; sublabel?: string; verdict?: string; sort?: string }
  | { type: "ai_search"; prompt: string };

export type LandingFact = {
  stat: string;
  headline: string;
  tone: "bad" | "good" | "neutral";
  action: LandingFactAction;
  /** Button label — defaults to "See them" for expose/catalog, "Search" for ai */
  cta: string;
};

export type LandingGoalBoard = {
  goal: GoalId;
  label: string;
  tagline: string;
  picks: LandingPick[];
};

export type LandingPickOfDay = {
  pick: LandingPick;
  reasons: string[];
};

export type LandingBestInClassProduct = {
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  score: number;
  grade: string | null;
  protein: number | null;
  sugar: number | null;
};

export type LandingBestInClassCategory = {
  label: string;
  href: string;
  avgScore: number;
  skipPct: number;
  products: LandingBestInClassProduct[];
};

export type LandingDodgeProduct = {
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  score: number;
  claim: string;
  reality: string;
  price: number | null;
  image_urls: string[];
};

export type LandingWorthItProduct = {
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  score: number;
  grade: string | null;
  verdict: string | null;
  reason: string;
};

export type LandingInsights = {
  totalScored: number;
  avgScore: number;
  facts: LandingFact[];
  pickOfDay: LandingPickOfDay | null;
  goalBoards: LandingGoalBoard[];
  bestInClass: LandingBestInClassCategory[];
  dodgeList: LandingDodgeProduct[];
  worthItList: LandingWorthItProduct[];
};

export const EMPTY_LANDING_INSIGHTS: LandingInsights = {
  totalScored: 0,
  avgScore: 0,
  facts: [],
  pickOfDay: null,
  goalBoards: [],
  bestInClass: [],
  dodgeList: [],
  worthItList: [],
};

function sugarOf(n: ProductNutrition | null | undefined): number | null {
  const s = n?.sugar_g_100g ?? n?.added_sugar_g_100g;
  return typeof s === "number" ? s : null;
}

function toPick(p: ProductListItem, meta?: string | null): LandingPick {
  return {
    slug: p.slug,
    name: p.name,
    brand: p.brand ?? null,
    image: p.image_urls?.[0] ?? null,
    score: p.core_scores?.score ?? null,
    grade: p.core_scores?.grade ?? null,
    verdict: p.core_scores?.verdict ?? null,
    price: p.price_inr ?? null,
    meta: meta ?? null,
  };
}

function hasSublabel(p: ProductListItem, id: string): boolean {
  return Boolean((p.core_scores?.verdict_sublabels as string[] | undefined)?.includes(id));
}

/** Stable day index so the "pick of the day" rotates once per day, not per request. */
function dayIndex(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function rankBy(
  pool: ProductListItem[],
  scoreFn: (p: ProductListItem) => number,
  metaFn: (p: ProductListItem) => string | null,
  limit = 6,
): LandingPick[] {
  return pool
    .map((p) => ({ p, s: scoreFn(p) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ p }) => toPick(p, metaFn(p)));
}

function goalLabel(goal: GoalId): string {
  return GOAL_PROFILES.find((g) => g.id === goal)?.label ?? goal;
}

const GOAL_TAGLINES: Record<GoalId, string> = {
  balanced: "Highest all-round Core scores",
  gym: "Most protein without the junk",
  bulk: "Calorie-dense with real protein",
  diabetic: "Lowest sugar, scored clean",
  "fat-loss": "Filling, lower-calorie picks",
  pcos: "Low sugar, minimally processed",
  "protein-budget": "Most protein per rupee",
  kids: "Clean labels, no artificial colours",
  parents: "Protein-forward staples for elders",
};

function buildFacts(products: ProductListItem[], totalScored: number): LandingFact[] {
  const facts: LandingFact[] = [];
  const scored = products.filter((p) => p.core_scores);
  const healthyRe =
    /\b(healthy|protein|zero|diet|lite|light|natural|nutri|wellness|immunity|digestive|sugar free|no added sugar)\b/i;

  // 1. "Healthy"-marketed but weak
  const healthyMarketed = scored.filter((p) =>
    healthyRe.test(`${p.name} ${p.attributes?.["Key Features"] ?? ""}`),
  );
  const healthyButWeak = healthyMarketed.filter((p) => (p.core_scores?.score ?? 100) < 50);
  if (healthyMarketed.length >= 20 && healthyButWeak.length > 0) {
    const pct = Math.round((healthyButWeak.length / healthyMarketed.length) * 100);
    facts.push({
      stat: `${pct}%`,
      headline: `of products marketed as “healthy” actually score below 50`,
      tone: "bad",
      action: { type: "expose", slugs: healthyButWeak.map((p) => p.slug) },
      cta: "See them",
    });
  }

  // 2. Healthy-marketed but hidden sweeteners
  const hiddenSweetHealthy = scored.filter(
    (p) =>
      hasSublabel(p, "hidden_sweetener") &&
      healthyRe.test(`${p.name} ${p.attributes?.["Key Features"] ?? ""}`),
  );
  if (hiddenSweetHealthy.length >= 5) {
    facts.push({
      stat: `${hiddenSweetHealthy.length}`,
      headline: `“healthy” products still hide added sweeteners on the label`,
      tone: "bad",
      action: { type: "expose", slugs: hiddenSweetHealthy.map((p) => p.slug) },
      cta: "See them",
    });
  }

  // 3. Skip rate
  const skip = scored.filter((p) => p.core_scores?.verdict === "skip").length;
  if (skip > 0 && totalScored > 0) {
    const oneIn = Math.max(2, Math.round(totalScored / skip));
    facts.push({
      stat: `1 in ${oneIn}`,
      headline: `products here aren’t worth buying — Scout flags them so you skip them`,
      tone: "bad",
      action: { type: "catalog", verdict: "skip", sort: "score-asc" },
      cta: "See them",
    });
  }

  // 4. Ultra-processed share
  const ultraProducts = scored.filter(
    (p) => hasSublabel(p, "ultra_processed") || hasSublabel(p, "mostly_nova_4"),
  );
  if (ultraProducts.length > 0 && totalScored > 0) {
    const pct = Math.round((ultraProducts.length / totalScored) * 100);
    if (pct >= 5) {
      facts.push({
        stat: `${pct}%`,
        headline: `of everything on the shelf is ultra-processed`,
        tone: "bad",
        action: { type: "expose", slugs: ultraProducts.map((p) => p.slug).slice(0, 40) },
        cta: "See them",
      });
    }
  }

  // 5. Low-sugar rarity in biscuits — show the rare good ones
  const biscuits = scored.filter((p) => /biscuit|cookie/i.test(p.category ?? p.subcategory ?? ""));
  const lowSugarBiscuits = biscuits.filter((p) => {
    const s = sugarOf(p.nutrition);
    return s != null && s < 5;
  });
  if (biscuits.length >= 15 && lowSugarBiscuits.length > 0) {
    facts.push({
      stat: `${lowSugarBiscuits.length} of ${biscuits.length}`,
      headline: `biscuits have under 5g sugar per 100g`,
      tone: "neutral",
      action: { type: "expose", slugs: lowSugarBiscuits.map((p) => p.slug) },
      cta: "See them",
    });
  }

  // 6. Hidden sweeteners (generic fallback)
  if (!hiddenSweetHealthy.length) {
    const hiddenProducts = scored.filter((p) => hasSublabel(p, "hidden_sweetener"));
    if (hiddenProducts.length >= 10) {
      facts.push({
        stat: `${hiddenProducts.length}`,
        headline: `products hide added sweeteners you wouldn’t spot on the front`,
        tone: "bad",
        action: { type: "expose", slugs: hiddenProducts.map((p) => p.slug) },
        cta: "See them",
      });
    }
  }

  return facts.slice(0, 4);
}

function buildGoalBoards(products: ProductListItem[], ins: InsightLists): LandingGoalBoard[] {
  const scored = products.filter((p) => p.core_scores);

  const proteinMeta = (p: ProductListItem) => {
    const v = p.nutrition?.protein_g_100g;
    return typeof v === "number" ? `${Math.round(v)}g protein` : null;
  };
  const sugarMeta = (p: ProductListItem) => {
    const v = sugarOf(p.nutrition);
    return typeof v === "number" ? `${v.toFixed(1)}g sugar` : null;
  };
  const kcalMeta = (p: ProductListItem) => {
    const v = p.nutrition?.energy_kcal_100g;
    return typeof v === "number" ? `${Math.round(v)} kcal` : null;
  };
  const scoreMeta = (p: ProductListItem) => {
    const v = p.core_scores?.score;
    return typeof v === "number" ? `Score ${v}` : null;
  };

  const byGoal: Record<GoalId, LandingPick[]> = {
    balanced: ins.dailyStaples.slice(0, 6).map((r) => toPick(r.product, scoreMeta(r.product))),
    gym: (ins.gymPicks.length ? ins.gymPicks : ins.highProteinSnacks)
      .slice(0, 6)
      .map((r) => toPick(r.product, proteinMeta(r.product))),
    bulk: rankBy(
      scored.filter(
        (p) =>
          (p.nutrition?.protein_g_100g ?? 0) >= 10 &&
          (p.nutrition?.energy_kcal_100g ?? 0) >= 300 &&
          (p.core_scores?.score ?? 0) >= 45,
      ),
      (p) => (p.nutrition?.energy_kcal_100g ?? 0) + (p.nutrition?.protein_g_100g ?? 0) * 8,
      proteinMeta,
    ),
    diabetic: rankBy(
      scored.filter((p) => {
        const s = sugarOf(p.nutrition);
        return s != null && s < 5 && (p.core_scores?.score ?? 0) >= 50;
      }),
      (p) => (p.core_scores?.score ?? 0) - (sugarOf(p.nutrition) ?? 0),
      sugarMeta,
    ),
    "fat-loss": ins.lowCalorieFills.slice(0, 6).map((r) => toPick(r.product, kcalMeta(r.product))),
    pcos: rankBy(
      scored.filter((p) => {
        const s = sugarOf(p.nutrition);
        return (
          s != null &&
          s < 6 &&
          !hasSublabel(p, "ultra_processed") &&
          (p.core_scores?.score ?? 0) >= 50
        );
      }),
      (p) => p.core_scores?.score ?? 0,
      sugarMeta,
    ),
    "protein-budget": ins.proteinPerRupee.slice(0, 6).map((r) => toPick(r.product, proteinMeta(r.product))),
    kids: ins.kidFriendly.slice(0, 6).map((r) => toPick(r.product, scoreMeta(r.product))),
    parents: rankBy(
      scored.filter(
        (p) =>
          (p.nutrition?.protein_g_100g ?? 0) >= 10 &&
          (p.core_scores?.score ?? 0) >= 55 &&
          (sugarOf(p.nutrition) ?? 99) < 12,
      ),
      (p) => (p.core_scores?.score ?? 0) + (p.nutrition?.protein_g_100g ?? 0) * 1.5,
      proteinMeta,
    ),
  };

  return GOAL_PROFILES.map((g) => ({
    goal: g.id,
    label: goalLabel(g.id),
    tagline: GOAL_TAGLINES[g.id],
    picks: byGoal[g.id] ?? [],
  })).filter((b) => b.picks.length > 0);
}

function buildPickOfDay(ins: InsightLists): LandingPickOfDay | null {
  const pool = ins.dailyStaples.length ? ins.dailyStaples : ins.bestInCohort;
  if (!pool.length) return null;

  const top = pool.slice(0, 12);
  const chosen = top[dayIndex() % top.length]!.product;

  const reasons: string[] = [];
  const protein = chosen.nutrition?.protein_g_100g;
  const fiber = chosen.nutrition?.fiber_g_100g;
  const sug = sugarOf(chosen.nutrition);
  if (typeof protein === "number" && protein >= 8) reasons.push(`${Math.round(protein)}g protein per 100g`);
  if (typeof fiber === "number" && fiber >= 5) reasons.push(`${Math.round(fiber)}g fibre per 100g`);
  if (typeof sug === "number" && sug <= 3) reasons.push(`only ${sug.toFixed(1)}g sugar`);
  if (hasSublabel(chosen, "whole_food")) reasons.push("whole-food ingredients");
  if (hasSublabel(chosen, "clean_protein")) reasons.push("clean protein source");
  if (!reasons.length && chosen.core_scores?.score != null) {
    reasons.push(`Core score ${chosen.core_scores.score}/100`);
  }

  return {
    pick: toPick(chosen, chosen.core_scores?.score != null ? `Score ${chosen.core_scores.score}` : null),
    reasons: reasons.slice(0, 3),
  };
}

const HEALTH_CLAIMS_RE =
  /\b(healthy|protein|zero|diet|lite|light|natural|nutri|wellness|immunity|digestive|sugar.?free|no.?added.?sugar|high.?fiber|organic|whole.?grain|multigrain|fortified|enriched|probiotic)\b/i;

function buildBestInClass(products: ProductListItem[]): LandingBestInClassCategory[] {
  const scored = products.filter((p) => p.core_scores);
  const byCategory = new Map<string, ProductListItem[]>();
  for (const p of scored) {
    const cat = p.category?.trim();
    if (!cat) continue;
    const list = byCategory.get(cat) ?? [];
    list.push(p);
    byCategory.set(cat, list);
  }

  const result: LandingBestInClassCategory[] = [];
  for (const [cat, inCat] of byCategory) {
    if (inCat.length < 3) continue;
    const top = [...inCat]
      .sort((a, b) => (b.core_scores?.score ?? 0) - (a.core_scores?.score ?? 0))
      .slice(0, 3);
    const avgScore = Math.round(
      inCat.reduce((s, p) => s + (p.core_scores?.score ?? 0), 0) / inCat.length,
    );
    const skipPct = Math.round(
      (inCat.filter((p) => p.core_scores?.verdict === "skip").length / inCat.length) * 100,
    );
    result.push({
      label: cat,
      // Best-first within the whole category — NOT gated to daily_staple, which
      // returns empty for treat/skip-heavy aisles (chips, chocolate) and silently
      // fails. The category always has scored products; show them ranked.
      href: `/catalog?category=${encodeURIComponent(cat)}`,
      avgScore,
      skipPct,
      products: top.map((p) => ({
        slug: p.slug,
        name: p.name,
        brand: p.brand ?? null,
        image: p.image_urls?.[0] ?? null,
        score: p.core_scores?.score ?? 0,
        grade: p.core_scores?.grade ?? null,
        protein: p.nutrition?.protein_g_100g ?? null,
        sugar: sugarOf(p.nutrition),
      })),
    });
  }

  return result.sort((a, b) => b.avgScore - a.avgScore || a.label.localeCompare(b.label));
}

function worthItReason(p: ProductListItem): string {
  const parts: string[] = [];
  const protein = p.nutrition?.protein_g_100g;
  const fiber = p.nutrition?.fiber_g_100g;
  const sug = sugarOf(p.nutrition);
  if (typeof protein === "number" && protein >= 8) parts.push(`${Math.round(protein)}g protein`);
  if (typeof fiber === "number" && fiber >= 5) parts.push(`${Math.round(fiber)}g fibre`);
  if (typeof sug === "number" && sug <= 5) parts.push(`${sug.toFixed(1)}g sugar`);
  if (hasSublabel(p, "whole_food")) parts.push("whole-food ingredients");
  if (hasSublabel(p, "clean_protein")) parts.push("clean protein");
  if (!parts.length && p.core_scores?.score != null) {
    parts.push(`Core score ${p.core_scores.score}/100`);
  }
  return parts.slice(0, 2).join(" · ") || "Strong nutrition panel";
}

function buildWorthItList(products: ProductListItem[]): LandingWorthItProduct[] {
  const scored = products.filter((p) => p.core_scores);
  return scored
    .filter((p) => {
      const score = p.core_scores?.score ?? 0;
      const verdict = p.core_scores?.verdict;
      return (
        score >= 70 &&
        (verdict === "daily_staple" || verdict === "good_choice" || verdict === "occasional_treat")
      );
    })
    .sort((a, b) => (b.core_scores?.score ?? 0) - (a.core_scores?.score ?? 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      brand: p.brand ?? null,
      image: p.image_urls?.[0] ?? null,
      score: p.core_scores?.score ?? 0,
      grade: p.core_scores?.grade ?? null,
      verdict: p.core_scores?.verdict ?? null,
      reason: worthItReason(p),
    }));
}

function buildDodgeList(products: ProductListItem[]): LandingDodgeProduct[] {
  const scored = products.filter((p) => p.core_scores);

  const CONTRADICTING_LABELS = ["hidden_sweetener", "high_in_sugar", "very_high_in_sugar", "ultra_processed", "mostly_nova_4", "artificial_flavors", "high_saturated_fat", "excessive_sodium", "hazardous_additive", "label_mismatch"];

  const dodgers = scored.filter((p) => {
    const score = p.core_scores?.score ?? 100;
    const sublabels = (p.core_scores?.verdict_sublabels as string[] | undefined) ?? [];
    const hasClaim = HEALTH_CLAIMS_RE.test(p.name);

    // Health claim + contradicting sublabels = genuine dodge
    if (hasClaim && sublabels.some((s) => CONTRADICTING_LABELS.includes(s))) return true;

    // Kids-aisle products with high sugar or ultra-processed
    const kidsAisle = /snack|dairy|bread|cereal|biscuit|chocolate|fruit|milk/i;
    if (kidsAisle.test(p.category ?? "") && (
      sublabels.includes("high_in_sugar") || sublabels.includes("very_high_in_sugar") || sublabels.includes("ultra_processed")
    )) return true;

    // Strong health claim + terrible score
    if (hasClaim && score < 35) return true;

    return false;
  });
  return dodgers
    .sort((a, b) => (a.core_scores?.score ?? 0) - (b.core_scores?.score ?? 0))
    .map((p) => {
      const score = p.core_scores?.score ?? 0;
      const sublabels = (p.core_scores?.verdict_sublabels as string[] | undefined) ?? [];
      let claim = "Markets as healthy";
      if (/no.?added.?sugar|zero.?sugar/i.test(p.name)) claim = "No added sugar";
      else if (/high.?protein|protein.?rich/i.test(p.name)) claim = "High protein";
      else if (/organic/i.test(p.name)) claim = "Organic & natural";
      else if (/multigrain|whole.?grain/i.test(p.name)) claim = "Multigrain / whole grain";
      else if (/sugar.?free/i.test(p.name)) claim = "Sugar free";
      else if (/natural/i.test(p.name)) claim = "100% natural";
      else if (/diet|lite|light/i.test(p.name)) claim = "Diet / light";
      const realities: string[] = [];
      if (sublabels.includes("hidden_sweetener")) realities.push("hidden sweeteners");
      if (sublabels.includes("ultra_processed")) realities.push("ultra-processed (NOVA 4)");
      if (sublabels.includes("high_in_sugar") || sublabels.includes("very_high_in_sugar")) realities.push("high in sugar");
      if (sublabels.includes("artificial_flavors")) realities.push("artificial flavours");
      if (sublabels.includes("high_saturated_fat")) realities.push("high saturated fat");
      if (!realities.length) realities.push(`score just ${score}/100`);
      return {
        slug: p.slug,
        name: p.name,
        brand: p.brand ?? null,
        image: p.image_urls?.[0] ?? null,
        score,
        claim,
        reality: realities.join(", "),
        price: p.price_inr ?? null,
        image_urls: p.image_urls,
      };
    });
}

export function buildLandingInsights(
  products: ProductListItem[],
  opts?: { totalScored?: number },
): LandingInsights {
  const scored = products.filter((p) => p.core_scores);
  const totalScored = opts?.totalScored ?? scored.length;
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, p) => s + (p.core_scores?.score ?? 0), 0) / scored.length)
    : 0;
  const ins = buildInsights(products);

  return {
    totalScored,
    avgScore,
    facts: buildFacts(products, totalScored),
    pickOfDay: buildPickOfDay(ins),
    goalBoards: buildGoalBoards(products, ins),
    bestInClass: buildBestInClass(products),
    dodgeList: buildDodgeList(products),
    worthItList: buildWorthItList(products),
  };
}
