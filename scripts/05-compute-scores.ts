#!/usr/bin/env -S pnpm tsx
/**
 * Compute Core scores for products in the DB and upsert into core_scores.
 *
 *   pnpm score                           # all products with nutrition
 *   pnpm score -- --with-detail          # only PDP-scraped cohort (~50 SKUs)
 *   pnpm score -- --limit=50
 *   pnpm score -- --dry-run
 *   pnpm score -- --force                # re-score all (batched upserts)
 *   pnpm score -- --only-unscored        # skip rows already on current rule_version
 *   pnpm score -- --label-resolved --force  # LM-updated label fields only
 */

import { config as loadEnv } from "dotenv";
import { adminClient } from "@/lib/supabase/admin";
import {
  productHasDeepseekLabel,
  productHasLabelValueChange,
} from "@/lib/products/label-resolution";
import {
  persistCoreScoresBatch,
  purgeOutdatedCoreScores,
  getScoringEngine,
  getScoringRuleVersion,
  type ScoreableProduct,
} from "@/lib/scoring/persist-core";
import type { ProductNutrition } from "@/lib/supabase/types";

loadEnv({ path: ".env.local" });

function parseArgs() {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let skus: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--limit=")) limit = Number(a.split("=")[1]);
    if (a.startsWith("--sku=")) skus = a.slice("--sku=".length).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return {
    limit,
    skus,
    dryRun: argv.includes("--dry-run"),
    withDetail: argv.includes("--with-detail"),
    force: argv.includes("--force"),
    onlyUnscored: argv.includes("--only-unscored"),
    labelResolved: argv.includes("--label-resolved"),
    deepseek: argv.includes("--deepseek"),
  };
}

async function main() {
  const args = parseArgs();
  const supabase = adminClient();
  const started = Date.now();
  console.log(
    `[05-compute-scores] engine=${getScoringEngine()} rule_version=${getScoringRuleVersion()}`,
  );

  if (args.force && !args.dryRun) {
    const purged = await purgeOutdatedCoreScores(supabase);
    if (purged) console.log(`[05-compute-scores] purged ${purged} outdated core_scores rows`);
  }

  const selectFields =
    args.force && !args.labelResolved && !args.deepseek
      ? "id, name, category, subcategory, ingredients_raw, nutrition, attributes"
      : args.labelResolved || args.deepseek
        ? "id, name, category, subcategory, ingredients_raw, nutrition, attributes, ocr_payload, core_scores ( rule_version )"
        : "id, name, category, subcategory, ingredients_raw, nutrition, attributes, core_scores ( rule_version )";

  let query: any = supabase.from("products").select(selectFields).not("nutrition", "is", null);
  if (args.skus.length) {
    query = query.in("zepto_sku", args.skus);
    console.log(`[05-compute-scores] --sku: ${args.skus.length} SKU(s).`);
  }

  if (args.withDetail) {
    query = query.not("raw_payload", "is", null);
    console.log("[05-compute-scores] --with-detail: PDP-scraped products only.");
  }

  if (args.labelResolved) {
    query = query.not("ocr_payload", "is", null);
    console.log(
      "[05-compute-scores] --label-resolved: label ≠ listing (compare different), client filter.",
    );
  }

  if (args.deepseek && !args.skus.length) {
    console.log("[05-compute-scores] --deepseek: DeepSeek-promoted products only, client filter.");
  } else if (args.deepseek) {
    console.log("[05-compute-scores] --deepseek: validating supplied DeepSeek SKU(s).");
  }

  const pageSize = args.deepseek && !args.skus.length ? 500 : args.limit ?? 500;
  const deepseekTarget = args.deepseek && !args.skus.length ? args.limit : null;
  let deepseekSelected = 0;
  let scored = 0;
  let skipped = 0;
  let noNutrition = 0;
  let totalFetched = 0;
  let cursorId: string | null = null;
  const useKeyset = !args.skus.length && !args.limit;

  while (true) {
    let pageQuery = query.order("id", { ascending: true }).limit(pageSize);
    if (useKeyset && cursorId) {
      pageQuery = pageQuery.gt("id", cursorId);
    } else if (!useKeyset && totalFetched > 0) {
      pageQuery = pageQuery.range(totalFetched, totalFetched + pageSize - 1);
    }
    const { data: rows, error } = await pageQuery;
    if (error) {
      console.error("[05-compute-scores] fetch failed:", error);
      process.exit(1);
    }
    if (!rows?.length) {
      if (totalFetched === 0) {
        console.log("[05-compute-scores] no products with nutrition to score.");
      }
      break;
    }
    totalFetched += rows.length;
    if (useKeyset) {
      cursorId = rows[rows.length - 1]!.id as string;
    }

    const toScore: ScoreableProduct[] = [];
    let reachedDeepseekTarget = false;
    for (const row of rows) {
      if (
        args.labelResolved &&
        !productHasLabelValueChange(
          row.ocr_payload as Record<string, unknown> | null | undefined,
        )
      ) {
        skipped++;
        continue;
      }
      if (
        args.deepseek &&
        !productHasDeepseekLabel(
          row.ocr_payload as Record<string, unknown> | null | undefined,
        )
      ) {
        skipped++;
        continue;
      }
      if (deepseekTarget != null && deepseekSelected >= deepseekTarget) {
        reachedDeepseekTarget = true;
        break;
      }
      if (args.deepseek && !args.skus.length) {
        deepseekSelected++;
        if (deepseekTarget != null && deepseekSelected >= deepseekTarget) {
          reachedDeepseekTarget = true;
        }
      }

      const rel = row.core_scores as
        | { rule_version: number }
        | { rule_version: number }[]
        | null;
      const existing = Array.isArray(rel) ? rel[0] : rel;
      if (
        args.onlyUnscored &&
        !args.force &&
        existing?.rule_version === getScoringRuleVersion()
      ) {
        skipped++;
        continue;
      }

      toScore.push({
        id: row.id,
        name: row.name,
        category: row.category,
        subcategory: row.subcategory,
        ingredients_raw: row.ingredients_raw,
        nutrition: row.nutrition as ProductNutrition | null,
        attributes: (row.attributes ?? null) as Record<string, string> | null,
      });
      if (reachedDeepseekTarget) break;
    }

    if (toScore.length) {
      const outcome = await persistCoreScoresBatch(supabase, toScore, {
        dryRun: args.dryRun,
      });
      scored += outcome.scored;
      noNutrition += outcome.no_nutrition;
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[05-compute-scores] progress fetched=${totalFetched} scored=${scored} skipped=${skipped} no_nutrition=${noNutrition} (${elapsed}s)`,
    );

    if (reachedDeepseekTarget || rows.length < pageSize) break;
    if (args.limit && !(args.deepseek && !args.skus.length)) break;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[05-compute-scores] done. fetched=${totalFetched} scored=${scored} skipped=${skipped} no_nutrition=${noNutrition} engine=${getScoringEngine()} rule_version=${getScoringRuleVersion()} (${elapsed}s)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
