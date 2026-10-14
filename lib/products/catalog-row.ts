/**
 * Catalog rows as the label pipeline needs them, read from the products table.
 * The database is the only catalog source: scripts read from it and write back
 * to it, never from files.
 */
import postgres from "postgres";
import type { ProductNutrition } from "@/lib/supabase/types";

export type CatalogRow = {
  super_category: string | null;
  category: string | null;
  subcategory: string | null;
  l3_category: string | null;
  brand: string;
  name: string;
  pack_size: string | null;
  mrp_inr: number | null;
  price_inr: number | null;
  ingredients_raw: string | null;
  nutrition: ProductNutrition | null;
  product_key: string;
  slug: string;
  /** Retailer variant id (stable per listing). */
  zepto_sku: string;
  product_url: string;
  image_urls: string[];
};

type Row = Omit<CatalogRow, "mrp_inr" | "price_inr" | "brand" | "product_key" | "zepto_sku" | "product_url" | "image_urls"> & {
  brand: string | null; mrp_inr: string | null; price_inr: string | null; product_key: string | null;
  zepto_sku: string | null; product_url: string | null; image_urls: string[] | null; id: string;
};

/** Every product row (visible or not) with what label extraction reads. */
export async function loadCatalogRows(): Promise<CatalogRow[]> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql<Row[]>`
      select id, super_category, category, subcategory, l3_category, brand, name, net_weight pack_size,
             mrp_inr, price_inr, ingredients_raw, nutrition, product_key, slug, zepto_sku, product_url, image_urls
      from products
      order by name`;
    return rows.map(r => ({
      ...r,
      brand: r.brand ?? "",
      mrp_inr: r.mrp_inr == null ? null : Number(r.mrp_inr),
      price_inr: r.price_inr == null ? null : Number(r.price_inr),
      product_key: r.product_key ?? r.id,
      zepto_sku: r.zepto_sku ?? r.id,
      product_url: r.product_url ?? "",
      image_urls: r.image_urls ?? [],
    }));
  } finally {
    await sql.end();
  }
}
