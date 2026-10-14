#!/usr/bin/env -S pnpm tsx
/**
 * Fix products with implausible nutrition (bad OCR, decimal errors) by
 * reconciling with attribute blocks and auto-correcting decimal anomalies.
 */
import { config as loadEnv } from "dotenv";
import { parseBlinkitProductDetail } from "@/lib/grocery/blinkit";
import {
  detectNutritionAnomalies,
  nutritionHasCriticalAnomalies,
  sanitizeNutrition,
} from "@/lib/nutrition/anomaly";
import { reconcileNutrition } from "@/lib/nutrition/sanity";
import { adminClient } from "@/lib/supabase/admin";
import { persistCoreScore, hasScoreableNutrition } from "@/lib/scoring/persist-core";
import type { ProductNutrition } from "@/lib/supabase/types";

loadEnv({ path: ".env.local" });

function macroSum(n: ProductNutrition): number {
  return (n.protein_g_100g ?? 0) + (n.carbs_g_100g ?? 0) + (n.fat_g_100g ?? 0);
}

function rowNeedsFix(
  nutrition: ProductNutrition,
  name: string,
  category: string | null,
  subcategory: string | null,
): boolean {
  const ctx = { name, category, subcategory };
  if (nutritionHasCriticalAnomalies(nutrition, ctx)) return true;
  if (macroSum(nutrition) > 100) return true;
  if (detectNutritionAnomalies(nutrition, ctx).some((a) => a.code === "decimal_anomaly")) {
    return true;
  }
  return false;
}

async function main() {
  const nameQ = process.argv.find((a) => a.startsWith("--name="))?.split("=")[1];
  const supabase = adminClient();
  let offset = 0;
  const page = 50;
  let fixed = 0;

  while (true) {
    let q = supabase
      .from("products")
      .select(
        "id, zepto_sku, name, category, subcategory, net_weight, ingredients_raw, nutrition, attributes, raw_payload",
      )
      .not("nutrition", "is", null);
    if (nameQ) {
      q = q.ilike("name", "%" + nameQ + "%");
    } else {
      // Broad net: high protein, low kcal, or macro mass overflow.
      q = q.or(
        "nutrition->protein_g_100g.gt.25,nutrition->protein_g_100g.gt.40,nutrition->energy_kcal_100g.lt.15",
      );
    }

    const { data, error } = await q.range(offset, offset + page - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      const prev = row.nutrition as ProductNutrition;
      const ctx = { name: row.name, category: row.category, subcategory: row.subcategory };
      if (!rowNeedsFix(prev, row.name, row.category, row.subcategory)) continue;

      const attrs = (row.attributes ?? {}) as Record<string, string>;
      let next: ProductNutrition | null = reconcileNutrition({
        nutrition: prev,
        attributes: attrs,
        name: row.name,
        category: row.category,
        subcategory: row.subcategory,
        net_weight: row.net_weight,
      });

      if (row.raw_payload) {
        const parsed = parseBlinkitProductDetail(row.zepto_sku, row.raw_payload as Record<string, unknown>);
        const mergedAttrs = { ...attrs, ...(parsed.attributes ?? {}) };
        next = reconcileNutrition({
          nutrition: parsed.nutrition ?? prev,
          attributes: mergedAttrs,
          name: parsed.name ?? row.name,
          category: row.category,
          subcategory: row.subcategory,
          net_weight: row.net_weight,
        });
      }

      // Direct sanitize for rows without an attribute fallback.
      if (!next || nutritionHasCriticalAnomalies(next, ctx)) {
        next = sanitizeNutrition(prev, ctx);
      }

      if (!next || JSON.stringify(prev) === JSON.stringify(next)) continue;
      if (nutritionHasCriticalAnomalies(next, ctx)) continue;

      await supabase.from("products").update({ nutrition: next }).eq("id", row.id);
      fixed++;
      console.log("[fix] " + row.name);
      console.log("  was protein=" + prev.protein_g_100g + " kcal=" + prev.energy_kcal_100g);
      console.log("  now protein=" + next.protein_g_100g + " kcal=" + next.energy_kcal_100g);

      if (hasScoreableNutrition(next)) {
        await persistCoreScore(
          supabase,
          {
            id: row.id,
            name: row.name,
            category: row.category,
            subcategory: row.subcategory,
            ingredients_raw: row.ingredients_raw,
            nutrition: next,
            attributes: attrs,
          },
          { force: true },
        );
      }
    }

    if (data.length < page) break;
    offset += page;
  }

  console.log("[fix-nutrition-outliers] done. fixed=" + fixed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
