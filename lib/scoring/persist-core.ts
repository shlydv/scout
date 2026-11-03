import { nutritionReviewStatus } from "@/lib/nutrition/review";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countNutritionFields } from "@/lib/nutrition/completeness";
import { nutritionHasCriticalAnomalies } from "@/lib/nutrition/anomaly";
import { computeCoreScore, type CoreScoreResult } from "@/lib/scoring/core";
import type { CoreScoreV9Result } from "@/lib/scoring/core-v9";
import {
  computeCoreScoreV9ForRow,
  preloadV9ForProducts,
  type V9Preload,
} from "@/lib/scoring/v9-batch";
import type { ProductNutrition } from "@/lib/supabase/types";

export function getScoringEngine(): string {
  return (process.env.SCORING_ENGINE ?? "v9").toLowerCase();
}

export function getScoringRuleVersion(): number {
  return Number(
    process.env.SCORING_RULE_VERSION ?? (getScoringEngine() === "v9" ? 10 : 8),
  );
}

export type ScoreableProduct = {
  id: string;
  name: string | null;
  category: string | null;
  subcategory: string | null;
  ingredients_raw: string | null;
  nutrition: ProductNutrition | null;
  attributes: Record<string, string> | null;
};

type CoreScoreUpsert = {
  product_id: string;
  score: number;
  grade: CoreScoreResult["grade"];
  band: CoreScoreResult["band"];
  subscores: { nutrition: number; additives: number; labels: number };
  concerns: CoreScoreResult["concerns"];
  breakdown: Record<string, unknown>;
  rule_version: number;
  computed_at: string;
  absolute_score?: number | null;
  relative_score?: number | null;
  verdict?: string | null;
  verdict_sublabels?: string[];
  role_cohort?: string | null;
  serving_g_effective?: number | null;
  cohort_id?: string | null;
  cohort_size?: number | null;
};

function v9ToUpsert(row: ScoreableProduct, result: CoreScoreV9Result): CoreScoreUpsert {
  return {
    product_id: row.id,
    score: result.score,
    grade: result.grade,
    band: result.band,
    subscores: {
      nutrition: result.subscores.nutrition,
      additives: result.subscores.ingredient,
      labels: result.subscores.labels,
    },
    concerns: result.concerns,
    breakdown: result.breakdown,
    rule_version: getScoringRuleVersion(),
    computed_at: new Date().toISOString(),
    absolute_score: result.absolute_score,
    relative_score: result.relative_score,
    verdict: result.verdict,
    verdict_sublabels: result.verdict_sublabels,
    role_cohort: result.role_cohort,
    serving_g_effective: result.serving_g_effective,
    cohort_id: result.cohort_id,
    cohort_size: result.cohort_size,
  };
}

export function hasScoreableNutrition(
  nutrition: ProductNutrition | Record<string, unknown> | null,
): boolean {
  if (!nutrition || typeof nutrition !== "object") return false;
  // A manually reviewed incomplete panel must not regain a score in a later batch.
  const reviewed = nutritionReviewStatus(nutrition as ProductNutrition);
  if (reviewed) {
    if (reviewed !== "verified") return false;
    const required = ["energy_kcal_100g", "protein_g_100g", "carbs_g_100g", "fat_g_100g", "sugar_g_100g", "sodium_mg_100g"] as const;
    if (required.some(key => typeof nutrition[key] !== "number" || !Number.isFinite(nutrition[key]))) return false;
  }
  // Single stray field (e.g. only bogus protein) must not drive a score.
  if (countNutritionFields(nutrition) < 2) return false;
  return true;
}

export function buildCoreScoreUpsert(
  row: ScoreableProduct,
  v9?: { preload: V9Preload },
): CoreScoreUpsert | null {
  if (getScoringEngine() === "v9" && v9?.preload) {
    if (!hasScoreableNutrition(row.nutrition)) return null;
    if (
      row.nutrition &&
      nutritionHasCriticalAnomalies(row.nutrition, {
        name: row.name ?? "",
        category: row.category,
        subcategory: row.subcategory,
      })
    ) {
      return null;
    }
    const result = computeCoreScoreV9ForRow(row, v9.preload);
    return v9ToUpsert(row, result);
  }
  if (!hasScoreableNutrition(row.nutrition)) return null;

  if (
    row.nutrition &&
    nutritionHasCriticalAnomalies(row.nutrition, {
      name: row.name ?? "",
      category: row.category,
      subcategory: row.subcategory,
    })
  ) {
    return null;
  }

  const result = computeCoreScore({
    ingredients_raw: row.ingredients_raw,
    nutrition: row.nutrition,
    category: row.category,
    subcategory: row.subcategory,
    product_name: row.name,
    attributes: row.attributes,
  });

  return {
    product_id: row.id,
    score: result.score,
    grade: result.grade,
    band: result.band,
    subscores: result.subscores,
    concerns: result.concerns,
    breakdown: result.breakdown,
    rule_version: getScoringRuleVersion(),
    computed_at: new Date().toISOString(),
  };
}

const UPSERT_BATCH = 100;

export async function persistCoreScoresBatch(
  supabase: SupabaseClient,
  rows: ScoreableProduct[],
  opts: { dryRun?: boolean } = {},
): Promise<{ scored: number; no_nutrition: number }> {
  const scoreable = rows.filter((r) => {
    if (!hasScoreableNutrition(r.nutrition)) return false;
    if (
      r.nutrition &&
      nutritionHasCriticalAnomalies(r.nutrition, {
        name: r.name ?? "",
        category: r.category,
        subcategory: r.subcategory,
      })
    ) {
      return false;
    }
    return true;
  });

  let v9Preload: V9Preload | undefined;
  if (getScoringEngine() === "v9" && scoreable.length) {
    v9Preload = await preloadV9ForProducts(supabase, scoreable);
  }

  const payloads: CoreScoreUpsert[] = [];
  for (const row of rows) {
    const payload = buildCoreScoreUpsert(row, v9Preload ? { preload: v9Preload } : undefined);
    if (payload) payloads.push(payload);
  }

  if (opts.dryRun) {
    return { scored: payloads.length, no_nutrition: rows.length - payloads.length };
  }

  let scored = 0;
  for (let i = 0; i < payloads.length; i += UPSERT_BATCH) {
    const chunk = payloads.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from("core_scores").upsert(chunk);
    if (error) {
      console.warn(`[persist-core] batch upsert @${i}:`, error.message);
      continue;
    }
    scored += chunk.length;
  }

  return { scored, no_nutrition: rows.length - payloads.length };
}

/** Remove stale score rows when nutrition is no longer scoreable or rule version changed. */
export async function purgeCoreScoreForProduct(
  supabase: SupabaseClient,
  productId: string,
): Promise<void> {
  await supabase.from("core_scores").delete().eq("product_id", productId);
}

export async function purgeOutdatedCoreScores(
  supabase: SupabaseClient,
  ruleVersion = getScoringRuleVersion(),
): Promise<number> {
  const { data, error } = await supabase
    .from("core_scores")
    .select("product_id")
    .neq("rule_version", ruleVersion);
  if (error || !data?.length) return 0;
  const ids = data.map((r) => r.product_id as string);
  const DELETE_BATCH = 200;
  let purged = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const chunk = ids.slice(i, i + DELETE_BATCH);
    const { error: delErr } = await supabase
      .from("core_scores")
      .delete()
      .in("product_id", chunk);
    if (delErr) {
      console.warn("[persist-core] purge outdated:", delErr.message);
      break;
    }
    purged += chunk.length;
  }
  return purged;
}

export async function persistCoreScore(
  supabase: SupabaseClient,
  row: ScoreableProduct,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<"scored" | "skipped" | "no_nutrition"> {
  if (!hasScoreableNutrition(row.nutrition)) {
    if (!opts.dryRun) await purgeCoreScoreForProduct(supabase, row.id);
    return "no_nutrition";
  }

  if (
    row.nutrition &&
    nutritionHasCriticalAnomalies(row.nutrition, {
      name: row.name ?? "",
      category: row.category,
      subcategory: row.subcategory,
    })
  ) {
    if (!opts.dryRun) await purgeCoreScoreForProduct(supabase, row.id);
    return "no_nutrition";
  }

  if (!opts.force) {
    const { data: existing } = await supabase
      .from("core_scores")
      .select("product_id, rule_version")
      .eq("product_id", row.id)
      .maybeSingle();
    if (existing && existing.rule_version === getScoringRuleVersion()) {
      return "skipped";
    }
  }

  const payload = buildCoreScoreUpsert(row);
  if (!payload) {
    if (!opts.dryRun) await purgeCoreScoreForProduct(supabase, row.id);
    return "no_nutrition";
  }
  if (opts.dryRun) return "scored";

  const { error } = await supabase.from("core_scores").upsert(payload);
  if (error) {
    console.warn(`[persist-core] upsert ${row.id}:`, error.message);
    return "skipped";
  }
  return "scored";
}
