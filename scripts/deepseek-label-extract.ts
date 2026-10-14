#!/usr/bin/env -S pnpm tsx
/**
 * Local-first DeepSeek label extraction from completed Apple OCR payloads.
 *
 * This does not update Supabase/product fields. It writes local JSONL and
 * per-SKU JSON files for audit before any promotion step.
 *
 *   pnpm label:deepseek -- --limit=50 --sample=validation
 *   pnpm label:deepseek -- --sku=a5b27839-d7bb-4c42-9687-16ba67ea2d83
 *   pnpm label:deepseek -- --limit=100 --resume --concurrency=2
 *   pnpm label:deepseek -- --limit=100 --retries=1
 *   pnpm label:deepseek -- --limit=100 --max-input-chars=90000
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { basename, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  buildDeepseekUserPrompt,
  DeepseekExtractionError,
  extractLabelWithDeepseek,
  validateExtractedLabel,
  type DeepseekExtractionResult,
} from "@/lib/ocr/deepseek-label-extract";
import { adminClient } from "@/lib/supabase/admin";
import type { AppleRawOcrProduct } from "@/lib/ocr/apple-raw";
import {
  loadAppleRawOcrForSku,
  loadAppleRawOcrFromDb,
  safeSkuFileName,
} from "@/lib/ocr/load-apple-raw-ocr";
import { loadCatalogRows, type CatalogRow } from "@/lib/products/catalog-row";
import { scriptArgv } from "@/lib/util/script-argv";

loadEnv({ path: ".env.local" });

const OUT_DIR = resolve(process.cwd(), "data/cache/deepseek-label-extract");
const PRODUCT_OUT_DIR = resolve(OUT_DIR, "products");
const RESULTS_PATH = resolve(OUT_DIR, "results.jsonl");
const REVIEW_PATH = resolve(OUT_DIR, "review-summary.json");
const MAX_BATCH = 50_000;

type Args = {
  limit: number;
  limitExplicit: boolean;
  offset: number;
  sku: string | null;
  nameQuery: string | null;
  sample: "validation" | "sequential";
  resume: boolean;
  fresh: boolean;
  dryRun: boolean;
  concurrency: number;
  retries: number;
  maxInputChars: number;
};

type WorkItem = {
  row: CatalogRow;
  rawPath: string;
  raw: AppleRawOcrProduct;
  rawSource: "local" | "db";
};

function parseArgs(): Args {
  const argv = scriptArgv();
  let limit = 50;
  let limitExplicit = false;
  let offset = 0;
  let sku: string | null = null;
  let nameQuery: string | null = null;
  let sample: "validation" | "sequential" = "validation";
  let concurrency = 1;
  let retries = 0;
  let maxInputChars = 0;

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      limit = Number(arg.split("=")[1]) || limit;
      limitExplicit = true;
    } else if (arg.startsWith("--offset=")) {
      offset = Math.max(0, Number(arg.split("=")[1]) || 0);
    } else if (arg.startsWith("--sku=")) {
      sku = arg.slice("--sku=".length).trim() || null;
    } else if (arg.startsWith("--name=")) {
      nameQuery = arg.slice("--name=".length).trim() || null;
    } else if (arg.startsWith("--sample=")) {
      const value = arg.slice("--sample=".length);
      sample = value === "sequential" ? "sequential" : "validation";
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = Math.max(1, Math.min(50, Number(arg.split("=")[1]) || 1));
    } else if (arg.startsWith("--retries=")) {
      const parsed = Number(arg.split("=")[1]);
      retries = Number.isFinite(parsed) ? Math.max(0, Math.min(5, parsed)) : 0;
    } else if (arg.startsWith("--max-input-chars=")) {
      const parsed = Number(arg.split("=")[1]);
      maxInputChars = Number.isFinite(parsed) && parsed > 0 ? Math.max(5_000, parsed) : 0;
    }
  }

  return {
    limit: Math.min(limit, MAX_BATCH),
    limitExplicit,
    offset,
    sku,
    nameQuery,
    sample,
    resume: argv.includes("--resume"),
    fresh: argv.includes("--fresh"),
    dryRun: argv.includes("--dry-run"),
    concurrency,
    retries,
    maxInputChars,
  };
}

async function loadDoneSkus(): Promise<Set<string>> {
  const done = new Set<string>();
  try {
    const rl = createInterface({
      input: createReadStream(RESULTS_PATH),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { zepto_sku?: string; dry_run?: boolean };
        if (row.zepto_sku && !row.dry_run) done.add(row.zepto_sku);
      } catch {
        // ignore partial append line
      }
    }
  } catch {
    // first run
  }
  return done;
}

function validationScore(item: WorkItem): number {
  const text = item.raw.combined_text.toLowerCase();
  let score = 0;
  if (/akshayakalpa|paneer|tofu|yogurt|curd/i.test(item.row.name)) score += 8;
  if (/ice cream|beverage|drink|chips|snack|biscuit|chocolate/i.test(item.row.name + " " + item.row.category)) score += 4;
  if (item.raw.low_confidence_image_count > 0) score += 4;
  if (item.row.nutrition) score += 3;
  if (item.row.ingredients_raw) score += 2;
  if (/nutrition|energy|protein|carbohydrate|sodium|ingredients?/.test(text)) score += 2;
  score += Math.min(item.raw.image_count, 7) / 10;
  return score;
}

function takeMatching(
  source: WorkItem[],
  selected: WorkItem[],
  limit: number,
  test: (item: WorkItem) => boolean,
) {
  const seen = new Set(selected.map((item) => item.row.zepto_sku));
  for (const item of source) {
    if (selected.length >= limit) return;
    if (seen.has(item.row.zepto_sku)) continue;
    if (!test(item)) continue;
    selected.push(item);
    seen.add(item.row.zepto_sku);
  }
}

function selectValidationSample(items: WorkItem[], limit: number): WorkItem[] {
  const ranked = items
    .slice()
    .sort((a, b) => validationScore(b) - validationScore(a) || a.row.name.localeCompare(b.row.name));
  const selected: WorkItem[] = [];
  const perBucket = Math.max(5, Math.ceil(limit / 6));
  const knownProblem = (item: WorkItem) =>
    /akshayakalpa|paneer|tofu|yogurt|curd/i.test(item.row.name);

  takeMatching(ranked, selected, Math.min(limit, selected.length + perBucket), (item) =>
    knownProblem(item),
  );
  takeMatching(ranked, selected, Math.min(limit, selected.length + perBucket), (item) =>
    item.raw.low_confidence_image_count > 0 && !knownProblem(item),
  );
  takeMatching(ranked, selected, Math.min(limit, selected.length + perBucket), (item) =>
    Boolean(item.row.nutrition) && !knownProblem(item),
  );
  takeMatching(ranked, selected, Math.min(limit, selected.length + perBucket), (item) =>
    item.raw.image_count >= 6 && !knownProblem(item),
  );
  takeMatching(ranked, selected, Math.min(limit, selected.length + perBucket), (item) =>
    /ice cream|beverage|drink|chips|snack|biscuit|chocolate/i.test(`${item.row.name} ${item.row.category}`),
  );
  takeMatching(ranked, selected, limit, () => true);
  return selected.slice(0, limit);
}

function selectWork(items: WorkItem[], args: Args): WorkItem[] {
  let work = items;
  if (args.sku) {
    work = work.filter((item) => item.row.zepto_sku === args.sku);
  }
  if (args.nameQuery) {
    const q = args.nameQuery.toLowerCase();
    work = work.filter((item) => item.row.name.toLowerCase().includes(q));
  }
  if (args.sample === "validation" && !args.sku && !args.nameQuery) {
    work = selectValidationSample(work, args.limit);
  } else {
    if (args.offset > 0) work = work.slice(args.offset);
    work = work.slice(0, args.limit);
  }
  if (args.sku || args.nameQuery) {
    work = work.slice(0, args.limit);
  }
  return work;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < retries) await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function summarize(results: DeepseekExtractionResult[]): Record<string, unknown> {
  const count = results.length;
  const nutrition = results.filter((r) =>
    Object.values(r.extracted.nutrition.per_100g_or_100ml).some((v) => v != null),
  ).length;
  const ingredients = results.filter((r) =>
    r.extracted.ingredients.raw_list.length > 0,
  ).length;
  const allergens = results.filter((r) =>
    r.extracted.allergens.contains.length ||
    r.extracted.allergens.may_contain.length ||
    r.extracted.allergens.free_from_claims.length,
  ).length;
  const storage = results.filter((r) =>
    Boolean(
      r.extracted.storage_and_shelf_life.storage_instructions ||
      r.extracted.storage_and_shelf_life.shelf_life_months ||
      r.extracted.storage_and_shelf_life.best_before_format,
    ),
  ).length;
  const marketingClaims = results.filter((r) => r.extracted.marketing_claims.length).length;
  const validatorOk = results.filter((r) => r.validation.ok).length;
  const needsReview = results.filter((r) =>
    r.extracted.confidence.overall === "low" ||
    r.extracted.confidence.ingredients === "low" ||
    r.extracted.confidence.nutrition === "low" ||
    !r.validation.ok,
  ).length;
  const issues = new Map<string, number>();
  for (const result of results) {
    for (const issue of result.validation.issues) {
      issues.set(issue.code, (issues.get(issue.code) ?? 0) + 1);
    }
  }
  return {
    count,
    nutrition_coverage_pct: count ? Math.round((nutrition / count) * 1000) / 10 : 0,
    ingredient_coverage_pct: count ? Math.round((ingredients / count) * 1000) / 10 : 0,
    allergen_coverage_pct: count ? Math.round((allergens / count) * 1000) / 10 : 0,
    storage_coverage_pct: count ? Math.round((storage / count) * 1000) / 10 : 0,
    marketing_claims_pct: count ? Math.round((marketingClaims / count) * 1000) / 10 : 0,
    validator_ok_pct: count ? Math.round((validatorOk / count) * 1000) / 10 : 0,
    needs_review_pct: count ? Math.round((needsReview / count) * 1000) / 10 : 0,
    issue_counts: Object.fromEntries([...issues.entries()].sort((a, b) => b[1] - a[1])),
  };
}

async function main() {
  const args = parseArgs();
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PRODUCT_OUT_DIR, { recursive: true });

  const rows = await loadCatalogRows();
  const dbRaw = await loadAppleRawOcrFromDb(
    adminClient(),
    rows.map((r) => r.zepto_sku),
  );
  const items: WorkItem[] = [];
  let fromLocal = 0;
  let fromDb = 0;
  for (const row of rows) {
    const loaded = await loadAppleRawOcrForSku(row.zepto_sku, dbRaw);
    if (!loaded) continue;
    if (loaded.source === "local") fromLocal++;
    else fromDb++;
    items.push({
      row,
      raw: loaded.raw,
      rawPath: loaded.path,
      rawSource: loaded.source,
    });
  }
  console.log(
    `[deepseek-label] apple_raw sources: local=${fromLocal} db=${fromDb} missing=${rows.length - items.length}`,
  );

  const done = args.resume && !args.fresh ? await loadDoneSkus() : new Set<string>();
  // When resuming a large sequential batch, pick the next N pending SKUs (not the first N catalog rows).
  let pool = items;
  if (
    args.resume &&
    !args.fresh &&
    args.sample === "sequential" &&
    args.limitExplicit &&
    !args.sku &&
    !args.nameQuery
  ) {
    pool = items.filter((item) => !done.has(item.row.zepto_sku));
  }
  let work = selectWork(pool, args).filter((item) => !done.has(item.row.zepto_sku));

  if (args.sku && work.length === 0) {
    throw new Error(`No work found for --sku=${args.sku}; OCR JSON may be missing or already done.`);
  }

  console.log(
    `[deepseek-label] work=${work.length} offset=${args.offset} sample=${args.sample} concurrency=${args.concurrency} dry_run=${args.dryRun} out=${RESULTS_PATH}`,
  );

  const out = createWriteStream(RESULTS_PATH, { flags: "a" });
  const completed: DeepseekExtractionResult[] = [];
  let next = 0;
  let processed = 0;
  let errors = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const idx = next++;
      if (idx >= work.length) return;
      const item = work[idx]!;
      const label = `${item.row.name.slice(0, 46)} (${item.row.zepto_sku.slice(0, 8)}...)`;
      const started = Date.now();
      try {
        if (args.dryRun) {
          const prompt = buildDeepseekUserPrompt({
            product: item.row,
            raw: item.raw,
            maxChars: args.maxInputChars,
          });
          const dryResult = {
            zepto_sku: item.row.zepto_sku,
            name: item.row.name,
            dry_run: true,
            prompt_chars: prompt.length,
            raw_path: item.rawPath,
            prompt_preview: prompt.slice(0, 2000),
            at: new Date().toISOString(),
          };
          out.write(`${JSON.stringify(dryResult)}\n`);
        } else {
          const result = await withRetries(
            () => extractLabelWithDeepseek({
              product: item.row,
              raw: item.raw,
              maxInputChars: args.maxInputChars,
            }),
            args.retries,
          );
          result.validation = validateExtractedLabel(result.extracted);
          completed.push(result);
          const productPath = resolve(PRODUCT_OUT_DIR, `${safeSkuFileName(item.row.zepto_sku)}.json`);
          await writeFile(
            productPath,
            JSON.stringify(
              {
                ...result,
                source_apple_ocr_path: item.rawPath,
                source_apple_ocr: item.rawSource,
                apple_ocr_combined_text_chars: item.raw.combined_text.length,
                apple_ocr_image_count: item.raw.image_count,
              },
              null,
              2,
            ),
            "utf8",
          );
          out.write(`${JSON.stringify({ ...result, local_json: productPath })}\n`);
        }
        processed++;
        const sec = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`[${processed}/${work.length}] ${label} ok (${sec}s)`);
      } catch (e) {
        errors++;
        const message = e instanceof Error ? e.message : String(e);
        const extractionError = e instanceof DeepseekExtractionError ? e : null;
        out.write(
          `${JSON.stringify({
            zepto_sku: item.row.zepto_sku,
            name: item.row.name,
            error: message,
            raw_response: extractionError?.rawResponse ?? undefined,
            usage: extractionError?.usage ?? undefined,
            response_metadata: extractionError?.responseMetadata ?? undefined,
            at: new Date().toISOString(),
          })}\n`,
        );
        console.error(`[deepseek-label] ${label}: ${message}`);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(args.concurrency, work.length) }, () => worker()));
  } finally {
    out.end();
    await finished(out);
  }

  if (completed.length) {
    const summary = summarize(completed);
    await writeFile(REVIEW_PATH, JSON.stringify(summary, null, 2), "utf8");
    console.log(`[deepseek-label] review ${JSON.stringify(summary)}`);
  }
  console.log(`[deepseek-label] done processed=${processed} errors=${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
