#!/usr/bin/env -S pnpm tsx
/** Build retrieval documents and embeddings from source facts, without LLM enrichment.
 * Supports --limit=N, --category=X, --subcategory=X, --skip-existing,
 * --skip-unchanged, --dry-run. --no-llm is accepted for existing callers.
 * Existing derived columns are untouched for other catalog consumers.
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { embedTexts } from "@/lib/search/embeddings";
import { productEvidence } from "@/lib/search/decision/retrieval";
import { computeProductSourceHash } from "@/lib/search/v2/source-hash";
import type { Product } from "@/lib/supabase/types";
config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const value = (key: string) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const limit = value("limit") ? Number(value("limit")) : Infinity;
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Error("Invalid --limit");
  const dryRun = args.includes("--dry-run");
  const db = adminClient();
  let processed = 0, scanned = 0;
  for (let offset = 0; processed < limit; offset += 100) {
    let query = db.from("products")
      .select("id,slug,name,brand,category,subcategory,l3_category,net_weight,price_inr,nutrition,ingredients_raw,attributes,product_url,updated_at,data_source,core_scores(score)")
      .eq("catalog_visible", true).order("id").range(offset, offset + 99);
    if (value("category")) query = query.eq("category", value("category")!);
    if (value("subcategory")) query = query.eq("subcategory", value("subcategory")!);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    scanned += data.length;
    const existing = await db.from("product_search_index").select("product_id,source_hash").in("product_id", data.map(p => p.id));
    if (existing.error) throw new Error(existing.error.message);
    const hashes = new Map((existing.data ?? []).map(r => [r.product_id, r.source_hash]));
    const rows = data.flatMap(raw => {
      const p = raw as unknown as Product;
      const scores = raw.core_scores as unknown as { score: number } | { score: number }[] | null;
      const score = (Array.isArray(scores) ? scores[0] : scores)?.score ?? null;
      const sourceHash = createHash("sha256").update(JSON.stringify([
        "decision-index-v1", computeProductSourceHash({ ...p, l3_category: p.l3_category ?? null }),
        p.price_inr, score, process.env.EMBEDDING_MODEL ?? "default", process.env.EMBEDDING_DIM ?? "1024",
      ])).digest("hex").slice(0, 20);
      if (args.includes("--skip-existing") && hashes.has(p.id)) return [];
      if (args.includes("--skip-unchanged") && hashes.get(p.id) === sourceHash) return [];
      // No ingredient truncation, taxonomy inference, trait generation or goal embeddings.
      const evidence = productEvidence(p);
      const { source: _source, id: _id, ...document } = evidence;
      const n = p.nutrition;
      const completeness = [p.ingredients_raw, p.nutrition, p.attributes].filter(Boolean).length / 3;
      return [{ product_id: p.id, slug: p.slug, name: p.name, brand: p.brand, category: p.category,
        subcategory: p.subcategory, l3_category: p.l3_category ?? null, price_inr: p.price_inr,
        scout_score: score, sugar_g: n?.sugar_g_100g ?? null, protein_g: n?.protein_g_100g ?? null,
        fat_g: n?.fat_g_100g ?? null, fiber_g: n?.fiber_g_100g ?? null, sodium_mg: n?.sodium_mg_100g ?? null,
        energy_kcal: n?.energy_kcal_100g ?? null, data_quality_score: completeness, data_completeness: completeness,
        search_doc: JSON.stringify(document), source_hash: sourceHash, built_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
    }).slice(0, limit - processed);
    if (!dryRun) {
      for (let start = 0; start < rows.length; start += 16) {
        const batch = rows.slice(start, start + 16);
        const embeddings = await embedTexts(batch.map(r => r.search_doc), "document");
        if (embeddings.length !== batch.length || embeddings.some(v => v.length !== 1024 || v.some(n => !Number.isFinite(n)))) {
          throw new Error("Embedding failed or has wrong dimensions; no partial batch was written");
        }
        const write = await db.from("product_search_index").upsert(batch.map((r, i) => ({ ...r, embedding: embeddings[i] })), { onConflict: "product_id" });
        if (write.error) throw new Error(write.error.message);
      }
    }
    processed += rows.length;
    console.log(JSON.stringify({ dry_run: dryRun, scanned, processed }));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
