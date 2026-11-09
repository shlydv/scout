/**
 * Compute products.catalog_visible from the TS eligibility rules.
 *   pnpm catalog:backfill-visible          rows whose inputs changed (catalog_checked_at is null)
 *   pnpm catalog:backfill-visible --all    every row
 * A product with hidden_reason set stays hidden whatever its data says.
 */
import { config as loadEnv } from "dotenv";
import { computeCatalogVisible } from "@/lib/products/catalog-eligibility";
import { adminClient } from "@/lib/supabase/admin";

loadEnv({ path: ".env.local" });

const PAGE = 500;
const UPDATE_CHUNK = 80;
const MAX_RETRIES = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= MAX_RETRIES) break;
      const wait = attempt * 1500;
      console.warn(`[backfill-catalog-visible] ${label} failed (${msg}) — retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function setVisible(
  supabase: ReturnType<typeof adminClient>,
  ids: string[],
  visible: boolean,
  checkedAt: string,
): Promise<void> {
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    await withRetry(`update visible=${visible} (${chunk.length} ids)`, async () => {
      const { error } = await supabase
        .from("products")
        .update({ catalog_visible: visible, catalog_checked_at: checkedAt })
        .in("id", chunk);
      if (error) throw new Error(error.message);
    });
  }
}

async function main() {
  const supabase = adminClient();

  const all = process.argv.includes("--all");
  const { error: probeErr } = await supabase.from("products").select("catalog_checked_at, hidden_reason").limit(0);
  if (probeErr) {
    console.error(
      `[backfill-catalog-visible] ${probeErr.message}\n` +
        "Apply supabase/migrations/0053_catalog_visibility_state.sql first, then retry.",
    );
    process.exit(1);
  }

  // Page by id: rows leave the "unchecked" set as they are written, so offsets would skip rows.
  let after = "00000000-0000-0000-0000-000000000000";
  let updated = 0;
  let scanned = 0;

  for (;;) {
    const { data, error } = await withRetry(`fetch after=${after}`, async () => {
      let q = supabase
        .from("products")
        .select(
          "id, platform, zepto_sku, name, super_category, category, subcategory, ingredients_raw, nutrition, catalog_visible, hidden_reason",
        )
        .eq("platform", "zepto")
        .gt("id", after)
        .order("id")
        .limit(PAGE);
      if (!all) q = q.is("catalog_checked_at", null);
      const res = await q;
      if (res.error) throw new Error(res.error.message);
      return res;
    });

    if (!data?.length) break;

    const visibleIds: string[] = [];
    const hiddenIds: string[] = [];
    for (const row of data) {
      scanned++;
      const next = !row.hidden_reason && computeCatalogVisible({
        platform: row.platform,
        zepto_sku: row.zepto_sku,
        name: row.name,
        super_category: row.super_category,
        category: row.category,
        subcategory: row.subcategory,
        ingredients_raw: row.ingredients_raw,
        nutrition: row.nutrition,
      });
      if (next !== row.catalog_visible) updated++;
      (next ? visibleIds : hiddenIds).push(row.id);
    }

    // Every scanned row is written so it records when it was checked.
    const checkedAt = new Date().toISOString();
    if (visibleIds.length) await setVisible(supabase, visibleIds, true, checkedAt);
    if (hiddenIds.length) await setVisible(supabase, hiddenIds, false, checkedAt);

    if (data.length < PAGE) break;
    after = data[data.length - 1]!.id;
    if (scanned % 2000 === 0) {
      console.log(`[backfill-catalog-visible] scanned=${scanned} updated=${updated}`);
    }
  }

  console.log(`[backfill-catalog-visible] done scanned=${scanned} updated=${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
