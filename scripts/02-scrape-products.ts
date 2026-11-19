#!/usr/bin/env -S pnpm tsx
/**
 * Paginates every category and persists product summaries + (optionally) detail.
 *
 *   pnpm tsx scripts/02-scrape-products.ts             # summary only, all cats
 *   pnpm tsx scripts/02-scrape-products.ts --detail    # also fetch detail per SKU
 *   pnpm tsx scripts/02-scrape-products.ts --limit-cats=10 --pages-per-cat=2
 *
 * Architecture notes:
 *   • Two-phase by design: the cheap summary listing scrape (~10x faster than
 *     per-SKU detail) builds the universe of SKUs; a separate `--detail` pass
 *     fetches the per-product payload (images, FSSAI #, marketing text).
 *   • Source of truth (decided after spying on Blinkit's PDP API):
 *       - per-100g nutrition  → Blinkit (PRIMARY, populated for almost every
 *                               SKU because FSSAI mandates the table).
 *       - ingredients         → Blinkit when present (high-volume SKUs);
 *                               OCR back-label fills the long tail (Phase 3).
 *       - net qty             → Blinkit's cart_item.unit when present, OCR else.
 *     `products.attributes` is a flat key/value bag of EVERYTHING ELSE the
 *     platform exposed on the PDP (Country of Origin, Diet Preference,
 *     Allergen Information, Shelf Life, Seller, Disclaimer, Type, Flavour, …).
 *     Used purely for display, never for scoring.
 *   • Resumable: we journal each completed (platform, category, cursor) to
 *     `.cache/<platform>-scrape-progress.json` so a crash mid-run resumes from
 *     the next page instead of replaying ~10k requests.
 */

import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  getAdapter,
  loadSession,
  platformFromEnv,
} from "@/lib/grocery";
import { BlinkitAdapter } from "@/lib/grocery/blinkit";
import { closePlaywrightFetch } from "@/lib/grocery/http-playwright";
import type {
  ScrapedCategory,
  ScrapedProductDetail,
  ScrapedProductSummary,
} from "@/lib/grocery";
import { mapPool } from "@/lib/async-pool";
import { persistCoreScore, hasScoreableNutrition } from "@/lib/scoring/persist-core";
import { adminClient } from "@/lib/supabase/admin";
import type { ProductNutrition } from "@/lib/supabase/types";

loadEnv({ path: ".env.local" });

const RAW_DIR = "data/raw";
const CACHE_DIR = ".cache";

interface Args {
  detail: boolean;
  detailOnly: boolean;
  dryRun: boolean;
  limitCats: number | null;
  pagesPerCat: number;
  onlyCategories: string[] | null;
  skipCategories: string[] | null;
  ignoreProgress: boolean;
  maxProducts: number | null;
  detailConcurrency: number;
  detailBatchSize: number;
  scoreAfterDetail: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limitCats: number | null = null;
  let pagesPerCat = 100; // safety ceiling — most categories <= 30 pages
  let onlyCategories: string[] | null = null;
  let skipCategories: string[] | null = null;
  let maxProducts: number | null = null;
  for (const a of argv) {
    if (a.startsWith("--limit-cats=")) limitCats = Number(a.split("=")[1]);
    if (a.startsWith("--pages-per-cat=")) pagesPerCat = Number(a.split("=")[1]);
    if (a.startsWith("--only-categories=")) {
      const raw = a.split("=")[1];
      const sep = raw.includes("__")
        ? "__"
        : raw.includes(";")
          ? ";"
          : raw.includes("|")
            ? "|"
            : ",";
      onlyCategories = raw
        .split(sep)
        .map((s) => s.trim().toLowerCase().replace(/_/g, " "))
        .filter(Boolean);
    }
    if (a.startsWith("--skip-categories=")) {
      const raw = a.split("=")[1];
      const sep = raw.includes("__")
        ? "__"
        : raw.includes(";")
          ? ";"
          : raw.includes("|")
            ? "|"
            : ",";
      skipCategories = raw
        .split(sep)
        .map((s) => s.trim().toLowerCase().replace(/_/g, " "))
        .filter(Boolean);
    }
    if (a.startsWith("--max-products=")) maxProducts = Number(a.split("=")[1]);
  }
  const detailOnly = argv.includes("--detail-only");
  const detailConcurrency = Number(
    argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ??
      process.env.SCRAPE_CONCURRENCY ??
      4,
  );
  const detailBatchSize = Number(
    argv.find((a) => a.startsWith("--detail-batch="))?.split("=")[1] ??
      process.env.SCRAPE_DETAIL_BATCH ??
      500,
  );
  return {
    detail: argv.includes("--detail") || detailOnly,
    detailOnly,
    dryRun: argv.includes("--dry-run"),
    limitCats,
    pagesPerCat,
    onlyCategories,
    skipCategories,
    ignoreProgress: argv.includes("--ignore-progress"),
    maxProducts,
    detailConcurrency: Math.max(1, Math.min(12, detailConcurrency)),
    detailBatchSize: Math.max(50, Math.min(1000, detailBatchSize)),
    scoreAfterDetail: !argv.includes("--no-score-after-detail"),
  };
}

function categoryLabel(cat: ScrapedCategory): string {
  return `${cat.super_category_name ?? ""} ${cat.name}`.toLowerCase();
}

function matchesAny(label: string, needles: string[]): boolean {
  return needles.some((n) => label.includes(n));
}

function filterCategories(
  categories: ScrapedCategory[],
  args: Args,
): ScrapedCategory[] {
  let list = categories;
  if (args.onlyCategories?.length) {
    list = list.filter((c) => matchesAny(categoryLabel(c), args.onlyCategories!));
  }
  if (args.skipCategories?.length) {
    list = list.filter((c) => !matchesAny(categoryLabel(c), args.skipCategories!));
  }
  return list;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

interface Progress {
  // category id → last completed cursor (null = done)
  cursors: Record<string, string | null>;
  done: string[];
}

async function loadProgress(platform: string): Promise<Progress> {
  try {
    const raw = await readFile(
      path.join(CACHE_DIR, `${platform}-scrape-progress.json`),
      "utf8",
    );
    return JSON.parse(raw) as Progress;
  } catch {
    return { cursors: {}, done: [] };
  }
}

async function saveProgress(platform: string, p: Progress): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    path.join(CACHE_DIR, `${platform}-scrape-progress.json`),
    JSON.stringify(p, null, 2),
  );
}

async function loadDiscoveredCategories(
  platform: string,
): Promise<ScrapedCategory[]> {
  const rawPath = path.join(RAW_DIR, `${platform}-taxonomy.jsonl`);
  const raw = await readFile(rawPath, "utf8").catch(() => "");
  if (!raw.trim()) {
    throw new Error(
      `[02-scrape-products] ${rawPath} is empty. Run scripts/01-scrape-categories.ts first.`,
    );
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ScrapedCategory);
}

async function main() {
  const args = parseArgs();
  const { detail, detailOnly, dryRun, limitCats, pagesPerCat } = args;
  const platform = platformFromEnv();

  const session = await loadSession(platform);
  if (!session) {
    console.error(
      `[02-scrape-products] no session for "${platform}". ` +
        `Run scripts/00-warm-session.ts first.`,
    );
    process.exit(1);
  }
  if (!session.storage_state_path) {
    console.warn(
      "[02-scrape-products] WARNING: no storage_state_path in session — " +
        "requests will NOT use Playwright and will likely 403. " +
        "Run `pnpm warm-session` (Playwright mode), not --from-curl.",
    );
  } else {
    console.log(
      `[02-scrape-products] playwright session: ${session.storage_state_path} ` +
        `(warmed ${session.warmed_at})`,
    );
  }

  const adapter = getAdapter(platform, {
    rps: Number(process.env.GROCERY_RPS) || 2,
    burst: Number(process.env.GROCERY_BURST) || 1,
  });

  let categories = filterCategories(await loadDiscoveredCategories(platform), args);
  if (!categories.length) {
    console.error(
      "[02-scrape-products] no categories after filters. Check --only-categories / --skip-categories.",
    );
    process.exit(1);
  }
  const totalCats = limitCats ?? categories.length;
  categories = categories.slice(0, totalCats);
  console.log(
    `[02-scrape-products] platform=${platform}, ` +
      `categories=${categories.length}, pagesPerCat=${pagesPerCat}, detail=${detail}, ` +
      `ignoreProgress=${args.ignoreProgress}, dryRun=${dryRun}`,
  );
  if (args.onlyCategories?.length) {
    console.log(`[02-scrape-products] only: ${args.onlyCategories.join(", ")}`);
  }
  if (args.skipCategories?.length) {
    console.log(`[02-scrape-products] skip: ${args.skipCategories.join(", ")}`);
  }
  for (const c of categories) {
    console.log(`  · ${c.super_category_name}`);
  }

  const supabase = dryRun ? null : adminClient();

  await mkdir(RAW_DIR, { recursive: true });
  const summariesPath = path.join(RAW_DIR, `${platform}-products-summary.jsonl`);
  const detailsPath = path.join(RAW_DIR, `${platform}-products-detail.jsonl`);

  const progress = await loadProgress(platform);

  let scrapedTotal = 0;
  if (detailOnly) {
    console.log("[02-scrape-products] --detail-only: skipping listing phase.");
  }
  for (let ci = 0; detailOnly ? false : ci < categories.length; ci++) {
    const cat = categories[ci];
    if (!args.ignoreProgress && progress.done.includes(cat.id)) {
      console.log(`[${ci + 1}/${categories.length}] skip "${cat.name}" (already done)`);
      continue;
    }
    if (args.maxProducts != null && scrapedTotal >= args.maxProducts) {
      console.log(`[02-scrape-products] reached --max-products=${args.maxProducts}, stopping.`);
      break;
    }

    let cursor: string | undefined =
      progress.cursors[cat.id] ?? undefined;
    let page = 0;
    let inCategory = 0;

    while (page < pagesPerCat) {
      if (args.maxProducts != null && scrapedTotal >= args.maxProducts) break;
      page++;
      let resp;
      try {
        resp = await adapter.listProducts(session, cat, cursor);
      } catch (err) {
        console.warn(
          `[${ci + 1}/${categories.length}] "${cat.name}" page ${page} failed:`,
          (err as Error).message,
        );
        break;
      }

      for (const p of resp.products) {
        await appendFile(summariesPath, JSON.stringify(p) + "\n");
        inCategory++;
        if (args.maxProducts != null && scrapedTotal + inCategory >= args.maxProducts) {
          break;
        }
      }

      // Persist summaries in chunks to the DB.
      if (supabase && resp.products.length) {
        const rows = resp.products.map((p) => productSummaryRow(platform, p));
        const { error } = await supabase
          .from("products")
          .upsert(rows, { onConflict: "platform,zepto_sku" });
        if (error) {
          console.error(`[02-scrape-products] upsert error:`, error);
          process.exit(1);
        }
      }

      if (!resp.next_cursor) break;
      cursor = resp.next_cursor;
      progress.cursors[cat.id] = cursor;
      await saveProgress(platform, progress);
    }

    scrapedTotal += inCategory;
    console.log(
      `[${ci + 1}/${categories.length}] "${cat.name}" → +${inCategory} (total ${scrapedTotal})`,
    );
    if (!args.ignoreProgress && !progress.done.includes(cat.id)) {
      progress.done.push(cat.id);
    }
    progress.cursors[cat.id] = null;
    await saveProgress(platform, progress);
  }

  console.log(`[02-scrape-products] summary phase done. total products: ${scrapedTotal}`);

  if (!detail) return;

  // ────────────────────────────────────────────────────────────
  // Detail pass: per-SKU fetch with image_urls + barcode + fssai.
  // ────────────────────────────────────────────────────────────
  console.log(`[02-scrape-products] starting --detail pass…`);

  if (!supabase) {
    console.log(
      `[02-scrape-products] --dry-run skips detail pass (it queries DB for SKUs).`,
    );
    return;
  }

  console.log(
    `[02-scrape-products] detail: concurrency=${args.detailConcurrency}, ` +
      `batch=${args.detailBatchSize}, rps=${process.env.GROCERY_RPS ?? 2}, ` +
      `burst=${process.env.GROCERY_BURST ?? 1}`,
  );

  let ok = 0;
  let fail = 0;
  let consecutiveCf = 0;
  let processed = 0;
  let scoredInline = 0;
  const scoreAfterDetail = args.scoreAfterDetail;

  while (true) {
    const { data: skuRows, error: skuErr } = await supabase
      .from("products")
      .select("id, zepto_sku, name, category, subcategory, attributes")
      .eq("platform", platform)
      .is("raw_payload", null)
      .limit(args.detailBatchSize);
    if (skuErr) {
      console.error(`[02-scrape-products] failed to read pending SKUs:`, skuErr);
      process.exit(1);
    }
    if (!skuRows?.length) break;

    console.log(
      `[02-scrape-products] detail batch: ${skuRows.length} pending (done so far: ${processed})`,
    );

    await mapPool(skuRows, args.detailConcurrency, async (row) => {
      try {
        const detailResp = await adapter.getProductDetail(session, row.zepto_sku);
        await appendFile(detailsPath, JSON.stringify(detailResp) + "\n");

        const update = productDetailUpdate(detailResp);
        const { error } = await supabase
          .from("products")
          .update(update)
          .eq("id", row.id);
        if (error) console.warn(`detail upsert for ${row.zepto_sku}:`, error);
        else if (
          scoreAfterDetail &&
          hasScoreableNutrition(update.nutrition as ProductNutrition | null)
        ) {
          const r = await persistCoreScore(
            supabase,
            {
              id: row.id,
              name: detailResp.name ?? row.name,
              category: detailResp.category ?? row.category,
              subcategory: detailResp.subcategory ?? row.subcategory,
              ingredients_raw: detailResp.ingredients_raw,
              nutrition: detailResp.nutrition as ProductNutrition | null,
              attributes: (detailResp.attributes ?? row.attributes) as Record<
                string,
                string
              > | null,
            },
            { force: true },
          );
          if (r === "scored") scoredInline++;
        }
        ok++;
        consecutiveCf = 0;
      } catch (err) {
        const msg = (err as Error).message;
        const isCf = /403|just a moment|cloudflare/i.test(msg);
        if (isCf) consecutiveCf++;
        fail++;
        console.warn(`detail fail ${row.zepto_sku}: ${msg.slice(0, 120)}`);

        if (consecutiveCf >= 6) {
          console.warn(
            "[02-scrape-products] Cloudflare streak — recycling browser (run `pnpm warm-session` if this keeps happening)…",
          );
          if (adapter instanceof BlinkitAdapter) adapter.recycleBrowser();
          await closePlaywrightFetch();
          consecutiveCf = 0;
          await new Promise((r) => setTimeout(r, 12_000));
        }
      }
    });

    processed += skuRows.length;
    console.log(
      `[02-scrape-products] detail progress: processed=${processed} ok=${ok} fail=${fail}`,
    );

    if (skuRows.length < args.detailBatchSize) break;
  }

  console.log(
    `[02-scrape-products] detail results: ok=${ok} fail=${fail}` +
      (scoreAfterDetail ? ` scored_inline=${scoredInline}` : ""),
  );
  console.log(`[02-scrape-products] detail phase done.`);
}

function productSummaryRow(
  platform: string,
  p: ScrapedProductSummary,
): Record<string, unknown> {
  return {
    platform,
    zepto_sku: p.sku,
    // No platform name in public URLs; the trailing sku keeps slugs unique.
    slug: [slugify(p.brand ?? ""), slugify(p.name), p.sku].filter(Boolean).join("-"),
    name: p.name,
    brand: p.brand,
    super_category: p.super_category,
    category: p.category,
    subcategory: p.subcategory,
    net_weight: p.net_weight,
    price_inr: p.price_inr,
    mrp_inr: p.mrp_inr,
    image_urls: p.thumb_url ? [p.thumb_url] : [],
    product_url: p.product_url,
    updated_at: new Date().toISOString(),
  };
}

function productDetailUpdate(
  d: ScrapedProductDetail,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    image_urls: d.image_urls,
    barcode: d.barcode,
    ingredients_raw: d.ingredients_raw,
    nutrition: d.nutrition,
    attributes: d.attributes,
    raw_payload: d.raw_payload as object,
    updated_at: new Date().toISOString(),
  };
  // Only overwrite the fields below when the detail call actually has them —
  // don't trample whatever the listing scrape captured (which had super/cat
  // context from the URL, while the PDP response is category-agnostic).
  if (d.net_weight) patch.net_weight = d.net_weight;
  if (d.super_category) patch.super_category = d.super_category;
  if (d.category) patch.category = d.category;
  if (d.subcategory) patch.subcategory = d.subcategory;
  return patch;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
