/**
 * Pack-size grouping for any product list (catalog pages, home rails, insights).
 * Uses product_facts.variant_key (lib/facts/variant-key.ts): one card per product,
 * with its other sizes attached, instead of the same product repeated per pack.
 */
import { searchSql } from "@/lib/search/planned/db";

export type PackSize = { slug: string; net_weight: string | null; price_inr: number | null };

type VariantInfo = { key: string; sizes: PackSize[] };

export async function variantInfo(ids: string[]): Promise<Map<string, VariantInfo>> {
  const out = new Map<string, VariantInfo>();
  if (!ids.length) return out;
  try {
    const sql = searchSql();
    const rows = await sql<{ id: string; key: string; slug: string; net_weight: string | null; price_inr: number | null; pack_qty: number | null }[]>`
      with keys as (select product_id, variant_key from product_facts where product_id = any(${ids}::uuid[]) and variant_key is not null)
      select k.product_id::text id, k.variant_key key, p.slug, p.net_weight, p.price_inr::float8 price_inr, f.pack_qty::float8 pack_qty
      from keys k
      join product_facts f on f.variant_key = k.variant_key
      join products p on p.id = f.product_id and p.catalog_visible
      order by k.product_id, f.pack_qty nulls last, p.price_inr`;
    for (const r of rows) {
      const cur = out.get(r.id) ?? { key: r.key, sizes: [] };
      cur.sizes.push({ slug: r.slug, net_weight: r.net_weight, price_inr: r.price_inr });
      out.set(r.id, cur);
    }
  } catch (e) {
    // Grouping is cosmetic; on failure show the list ungrouped.
    console.warn("[variants] lookup failed", e instanceof Error ? e.message : e);
  }
  return out;
}

/** Keep the first item of each pack-size group (lists arrive already ranked). */
export async function collapseVariants<T extends { id: string }>(items: T[]): Promise<(T & { sizes?: PackSize[] })[]> {
  const info = await variantInfo(items.map(i => i.id));
  const seen = new Set<string>();
  const out: (T & { sizes?: PackSize[] })[] = [];
  for (const it of items) {
    const v = info.get(it.id);
    const key = v?.key ?? it.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v && v.sizes.length > 1 ? { ...it, sizes: v.sizes } : it);
  }
  return out;
}
