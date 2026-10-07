import { adminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/search/v2/embeddings";
import { mapDbRow } from "./index-row";
import type { Product, ProductNutrition } from "@/lib/supabase/types";
import type { ProductSearchIndexRow } from "@/lib/search/v2/types";

export type ProductEvidence = {
  id: string; name: string; brand: string | null;
  category: string | null; subcategory: string | null;
  ingredients: string | null; nutrition_per_100g: ProductNutrition | null;
  attributes: Record<string, string> | null;
  price_inr: number | null; pack: string | null;
  source: { url: string | null; updated_at: string; data_source: string | null };
};
export type EvidenceCandidate = { row: ProductSearchIndexRow; evidence: ProductEvidence };

export function productEvidence(product: Product): ProductEvidence {
  return {
    id: product.id, name: product.name, brand: product.brand,
    category: product.category, subcategory: product.subcategory,
    ingredients: product.ingredients_raw, nutrition_per_100g: product.nutrition,
    attributes: product.attributes, price_inr: product.price_inr, pack: product.net_weight,
    source: { url: product.product_url, updated_at: product.updated_at, data_source: product.data_source ?? null },
  };
}

export async function retrieveEvidence(query: string, limit = 24): Promise<EvidenceCandidate[]> {
  const db = adminClient();
  const embedding = await embedText(query, "query");
  // Do not silently turn an embedding outage into poor recall and "no matches".
  if (embedding.length !== 1024 || embedding.some(v => !Number.isFinite(v))) throw new Error("Search embedding unavailable or incompatible with the index");
  const { data, error } = await db.rpc("decision_search_candidates", {
    p_query: query, p_embedding: `[${embedding.join(",")}]`, p_limit: limit,
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw new Error("Search candidate retrieval failed");
  const rows = ((data ?? []) as { row_json: Record<string, unknown> }[]).map(r => mapDbRow(r.row_json));
  if (!rows.length) return [];
  const products = await db.from("products")
    .select("id,name,brand,category,subcategory,ingredients_raw,nutrition,attributes,price_inr,net_weight,product_url,updated_at,data_source")
    .in("id", rows.map(r => r.product_id)).eq("catalog_visible", true).abortSignal(AbortSignal.timeout(8_000));
  if (products.error) throw new Error("Product evidence could not be loaded");
  const byId = new Map((products.data ?? []).map(p => [p.id, p as Product]));
  return rows.flatMap(row => {
    const p = byId.get(row.product_id);
    if (!p) return [];
    // Current facts override potentially stale index display/sort values.
    const n = p.nutrition;
    return [{ row: { ...row, name: p.name, brand: p.brand, category: p.category,
      subcategory: p.subcategory, price_inr: p.price_inr,
      protein_g: n?.protein_g_100g ?? null, sugar_g: n?.sugar_g_100g ?? null,
      fat_g: n?.fat_g_100g ?? null, fiber_g: n?.fiber_g_100g ?? null,
      is_vegan: null, is_gluten_free: null, is_palm_oil_free: null, has_added_sugar: null,
    }, evidence: productEvidence(p) }];
  });
}
