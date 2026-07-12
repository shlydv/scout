"use client";

import { useEffect, useState, useCallback } from "react";
import { useAdminApi } from "@/components/admin-shell";
import type { ReviewSummary, ReviewProduct } from "@/app/api/admin/needs-review/route";

const ISSUE_LABELS: Record<string, string> = {
  energy_macro_mismatch: "Energy/macro mismatch",
  macro_total_high: "Macro total > 100g",
  gluten_free_allergen_conflict: "Gluten-free conflict",
  added_sugar_gt_total_sugar: "Added sugar > total sugar",
  sat_fat_gt_total_fat: "Sat fat > total fat",
  trans_fat_gt_total_fat: "Trans fat > total fat",
  chip_evidence_mismatch: "Chip evidence mismatch",
  nutrition_missing_evidence: "Nutrition missing evidence",
  ingredients_missing_evidence: "Ingredients missing evidence",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "text-green-600 bg-green-50",
  medium: "text-yellow-600 bg-yellow-50",
  low: "text-red-600 bg-red-50",
};

function ConfidenceBadge({ level }: { level: string }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CONFIDENCE_COLOR[level] ?? "text-gray-500 bg-gray-100"}`}>
      {level}
    </span>
  );
}

function IssuePill({ issue }: { issue: { severity: string; code: string; message: string } }) {
  return (
    <span
      title={issue.message}
      className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-help ${
        issue.severity === "error"
          ? "bg-red-100 text-red-700"
          : "bg-yellow-100 text-yellow-700"
      }`}
    >
      {ISSUE_LABELS[issue.code] ?? issue.code}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function NeedsReviewPage() {
  const api = useAdminApi();
  const [data, setData] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCode, setFilterCode] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCode) params.set("code", filterCode);
      params.set("page", String(page));
      const res = await api.fetch(`/api/admin/needs-review?${params}`);
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json() as ReviewSummary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, filterCode, page]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md text-center">
          <p className="text-red-600 font-medium">Failed to load</p>
          <p className="text-sm text-gray-500 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Data Quality Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            Products flagged by the LLM extraction validator. Fix issues before promoting to DB.
          </p>
        </div>

        {/* Stats */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Processed" value={data.total_processed.toLocaleString()} />
            <StatCard
              label="Needs Review"
              value={data.needs_review.toLocaleString()}
              sub={`${((data.needs_review / data.total_processed) * 100).toFixed(1)}% of total`}
            />
            <StatCard label="Validator Errors" value={data.validator_errors.toLocaleString()} />
            <StatCard label="Low Confidence" value={data.low_confidence.toLocaleString()} />
          </div>
        )}

        {/* Issue filter chips */}
        {data && Object.keys(data.issue_counts).length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Filter by issue</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setFilterCode(""); setPage(0); }}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                  !filterCode ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                }`}
              >
                All issues
              </button>
              {Object.entries(data.issue_counts).map(([code, count]) => (
                <button
                  key={code}
                  onClick={() => { setFilterCode(code); setPage(0); }}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                    filterCode === code ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {ISSUE_LABELS[code] ?? code} <span className="opacity-60">({count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Product list */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">Loading...</div>
          ) : !data || data.products.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              {filterCode ? "No products with this issue." : "No products need review. 🎉"}
            </div>
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {data.products.map((p) => (
                  <ProductRow key={p.zepto_sku} product={p} />
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                <p className="text-xs text-gray-500">
                  Showing {page * 50 + 1}–{Math.min((page + 1) * 50, data.needs_review)} of {data.needs_review}
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    className="text-xs px-3 py-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100 transition-colors"
                  >
                    ← Prev
                  </button>
                  <button
                    disabled={(page + 1) * 50 >= data.needs_review}
                    onClick={() => setPage((p) => p + 1)}
                    className="text-xs px-3 py-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4 text-center">
          Reading from <code className="font-mono">data/cache/deepseek-label-extract/results.jsonl</code>
          {" · "}Run <code className="font-mono">pnpm label:deepseek</code> to refresh
        </p>
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: ReviewProduct }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-4 py-3">
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Status dot */}
        <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${product.validation_ok ? "bg-yellow-400" : "bg-red-500"}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 truncate">{product.name}</span>
            <span className="text-xs text-gray-400 font-mono">{product.zepto_sku.slice(0, 8)}</span>
          </div>

          {/* Issue pills */}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {product.issues.map((issue, i) => (
              <IssuePill key={i} issue={issue} />
            ))}
            {product.issues.length === 0 && (
              <span className="text-xs text-gray-400">Low confidence</span>
            )}
          </div>
        </div>

        {/* Confidence */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <ConfidenceBadge level={product.confidence.overall} />
          <div className="flex gap-1">
            <span className="text-xs text-gray-400">N:</span>
            <ConfidenceBadge level={product.confidence.nutrition} />
            <span className="text-xs text-gray-400 ml-1">I:</span>
            <ConfidenceBadge level={product.confidence.ingredients} />
          </div>
        </div>

        <span className="text-gray-300 text-xs flex-shrink-0">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 ml-5 pl-3 border-l-2 border-gray-100 space-y-2">
          {product.why && (
            <p className="text-sm text-gray-600 italic">"{product.why}"</p>
          )}
          {product.chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {product.chips.map((chip) => (
                <span key={chip} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{chip}</span>
              ))}
            </div>
          )}
          <div className="flex gap-4 text-xs text-gray-500">
            <span>Nutrition: {product.nutrition_coverage ? "✓ found" : "✗ missing"}</span>
            <span>Ingredients: {product.ingredient_coverage ? "✓ found" : "✗ missing"}</span>
          </div>
          {product.issues.map((issue, i) => (
            <p key={i} className="text-xs text-gray-500">
              <span className={issue.severity === "error" ? "text-red-500 font-medium" : "text-yellow-600 font-medium"}>
                {issue.severity}:
              </span>{" "}
              {issue.message}
            </p>
          ))}
          <p className="text-xs text-gray-400">Extracted {new Date(product.at).toLocaleString()} · {product.model}</p>
        </div>
      )}
    </div>
  );
}
