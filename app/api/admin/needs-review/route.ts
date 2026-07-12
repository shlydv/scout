import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import type { DeepseekExtractionResult, ValidationIssue } from "@/lib/ocr/deepseek-label-extract";

const RESULTS_PATH = resolve(process.cwd(), "data/cache/deepseek-label-extract/results.jsonl");

export type ReviewProduct = {
  zepto_sku: string;
  name: string;
  model: string;
  at: string;
  validation_ok: boolean;
  issues: ValidationIssue[];
  confidence: { overall: string; nutrition: string; ingredients: string; notes: string | null };
  chips: string[];
  why: string | null;
  nutrition_coverage: boolean;
  ingredient_coverage: boolean;
};

export type ReviewSummary = {
  total_processed: number;
  needs_review: number;
  validator_errors: number;
  low_confidence: number;
  issue_counts: Record<string, number>;
  products: ReviewProduct[];
};

function needsReview(result: DeepseekExtractionResult): boolean {
  if (!result.validation.ok) return true;
  const c = result.extracted.confidence;
  if (c.overall === "low" || c.nutrition === "low" || c.ingredients === "low") return true;
  return false;
}

export async function GET(req: Request) {
  const { rejectUnlessAdmin } = await import("@/lib/auth/admin-gate");
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;

  // Local QA tool — reads a JSONL from disk that never ships with the deploy.
  // Hide it entirely in production rather than 404ing with internal details.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const filterCode = searchParams.get("code") ?? "";
  const page = Math.max(0, Number(searchParams.get("page") ?? "0"));
  const pageSize = 50;

  if (!existsSync(RESULTS_PATH)) {
    return NextResponse.json({ error: "No extraction results found. Run pnpm label:deepseek first." }, { status: 404 });
  }

  // Deduplicate — keep latest result per SKU
  const bySkuMap = new Map<string, DeepseekExtractionResult>();
  const rl = createInterface({ input: createReadStream(RESULTS_PATH), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as DeepseekExtractionResult & { dry_run?: boolean; error?: string };
      if (!row.zepto_sku || row.dry_run || row.error) continue;
      bySkuMap.set(row.zepto_sku, row);
    } catch { /* skip */ }
  }

  const all = [...bySkuMap.values()];
  const issueCounts: Record<string, number> = {};
  let validatorErrors = 0;
  let lowConfidence = 0;
  const reviewProducts: ReviewProduct[] = [];

  for (const result of all) {
    for (const issue of result.validation.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
    if (!result.validation.ok) validatorErrors++;
    const c = result.extracted.confidence;
    if (c.overall === "low" || c.nutrition === "low" || c.ingredients === "low") lowConfidence++;

    if (!needsReview(result)) continue;
    if (filterCode && !result.validation.issues.some((i) => i.code === filterCode)) continue;

    reviewProducts.push({
      zepto_sku: result.zepto_sku,
      name: result.name,
      model: result.model,
      at: result.at,
      validation_ok: result.validation.ok,
      issues: result.validation.issues,
      confidence: result.extracted.confidence,
      chips: result.extracted.chips,
      why: result.extracted.why,
      nutrition_coverage: Object.values(result.extracted.nutrition.per_100g_or_100ml).some((v) => v != null),
      ingredient_coverage: result.extracted.ingredients.raw_list.length > 0,
    });
  }

  // Sort: errors first, then by confidence level
  reviewProducts.sort((a, b) => {
    if (!a.validation_ok && b.validation_ok) return -1;
    if (a.validation_ok && !b.validation_ok) return 1;
    const confScore = (p: ReviewProduct) =>
      (p.confidence.overall === "low" ? 2 : p.confidence.overall === "medium" ? 1 : 0);
    return confScore(b) - confScore(a);
  });

  const summary: ReviewSummary = {
    total_processed: all.length,
    needs_review: reviewProducts.length,
    validator_errors: validatorErrors,
    low_confidence: lowConfidence,
    issue_counts: Object.fromEntries(
      Object.entries(issueCounts).sort((a, b) => b[1] - a[1])
    ),
    products: reviewProducts.slice(page * pageSize, (page + 1) * pageSize),
  };

  return NextResponse.json(summary);
}
