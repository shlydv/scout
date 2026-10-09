/** Inputs for product_search_index rows (search document + change detection). */
import { createHash } from "node:crypto";
import type { Product, ProductNutrition } from "@/lib/supabase/types";

/** Deterministic JSON stringify — sorts keys so JSONB ordering doesn't break hashes. */
function stableJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableJson).join(",") + "]";
  return "{" + Object.keys(obj as Record<string, unknown>).sort().map(k =>
    JSON.stringify(k) + ":" + stableJson((obj as Record<string, unknown>)[k])
  ).join(",") + "}";
}

/** Hash of raw catalog fields — skip re-enrichment when unchanged (§16.1). */
export function computeProductSourceHash(opts: {
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  l3_category: string | null;
  net_weight?: string | null;
  nutrition: unknown;
  ingredients_raw: string | null;
  attributes: Record<string, string> | null;
}): string {
  const payload = stableJson({
    name: opts.name?.trim(),
    brand: opts.brand?.trim() ?? null,
    category: opts.category?.trim() ?? null,
    subcategory: opts.subcategory?.trim() ?? null,
    l3_category: opts.l3_category?.trim() ?? null,
    net_weight: opts.net_weight?.trim() ?? null,
    nutrition: opts.nutrition,
    ingredients_raw: opts.ingredients_raw?.trim() ?? null,
    attributes: opts.attributes,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

export type ProductEvidence = {
  id: string; name: string; brand: string | null;
  category: string | null; subcategory: string | null;
  ingredients: string | null; nutrition_per_100g: ProductNutrition | null;
  attributes: Record<string, string> | null;
  price_inr: number | null; pack: string | null;
  source: { url: string | null; updated_at: string; data_source: string | null };
};

/** The product facts the search document (and its embedding) is built from. */
export function productEvidence(product: Product): ProductEvidence {
  return {
    id: product.id, name: product.name, brand: product.brand,
    category: product.category, subcategory: product.subcategory,
    ingredients: product.ingredients_raw, nutrition_per_100g: product.nutrition,
    attributes: product.attributes, price_inr: product.price_inr, pack: product.net_weight,
    source: { url: product.product_url, updated_at: product.updated_at, data_source: product.data_source ?? null },
  };
}
