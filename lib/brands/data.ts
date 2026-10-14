/**
 * Brand pages: every visible product of a brand, its Scout scores and any
 * verified label conflicts. Brands are matched case-insensitively ("PAPER BOAT"
 * and "Paper Boat" are one brand) and addressed by a slug of the name.
 */
import { unstable_cache } from "next/cache";
import { brandSlug } from "@/lib/brands/slug";
import { normalizeProductImageUrls } from "@/lib/products/catalog-hero-image";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import { searchSql } from "@/lib/search/planned/db";
import type { SearchCard } from "@/lib/search/planned/present";
import type { LabelConflict } from "@/lib/insights/data";

/** Smallest catalogue that gets a ranking; smaller brands still get a page. */
export const RANKED_MIN_PRODUCTS = 10;

export type BrandSummary = {
  slug: string;
  /** lower(brand) as stored, for queries (may carry stray characters the display name drops). */
  key: string;
  name: string;
  products: number;
  avgScore: number | null;
  skipPct: number;
  conflicts: number;
};

export type BrandAisle = { aisle: string; items: SearchCard[] };

export type BrandDetail = BrandSummary & {
  stapleOrGoodPct: number;
  best: SearchCard[];
  worst: SearchCard[];
  aisles: BrandAisle[];
  conflictCards: LabelConflict[];
};

/** Prefer the spelling a person would write ("Paper Boat" over "PAPER BOAT"). */
function displayName(variants: string[]): string {
  const clean = variants.map(v => v.replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "").trim());
  return clean.find(v => v !== v.toUpperCase()) ?? clean[0]!;
}

type ScoreRow = { brand_key: string; variants: string[]; name: string; category: string | null; subcategory: string | null; score: string | null };

const loadIndex = unstable_cache(
  async (): Promise<BrandSummary[]> => {
    const sql = searchSql();
    const rows = await sql<ScoreRow[]>`
      select lower(p.brand) brand_key, array[p.brand] variants, p.name, p.category, p.subcategory,
             coalesce(si.absolute_score, si.scout_score) score
      from products p left join product_search_index si on si.product_id = p.id
      where p.catalog_visible and p.brand is not null and trim(p.brand) <> ''`;
    const conflicts = await sql<{ brand_key: string; n: number }[]>`
      select lower(p.brand) brand_key, count(distinct lc.product_id)::int n
      from label_conflicts lc join products p on p.id = lc.product_id and p.catalog_visible
      group by 1`;
    const conflictMap = new Map(conflicts.map(c => [c.brand_key, c.n]));

    const byBrand = new Map<string, { variants: Set<string>; n: number; scored: number[]; skip: number }>();
    for (const r of rows) {
      const b = byBrand.get(r.brand_key) ?? { variants: new Set<string>(), n: 0, scored: [], skip: 0 };
      b.variants.add(r.variants[0]!);
      b.n++;
      if (r.score != null) {
        const score = Number(r.score);
        b.scored.push(score);
        if (resolveProductVerdict({ score, name: r.name, category: r.category, subcategory: r.subcategory }) === "skip") b.skip++;
      }
      byBrand.set(r.brand_key, b);
    }
    const seen = new Set<string>();
    const out: BrandSummary[] = [];
    for (const [key, b] of [...byBrand].sort((x, y) => y[1].n - x[1].n)) {
      const name = displayName([...b.variants]);
      const slug = brandSlug(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        slug, key, name, products: b.n,
        avgScore: b.scored.length ? Math.round(b.scored.reduce((s, x) => s + x, 0) / b.scored.length) : null,
        skipPct: b.scored.length ? Math.round((100 * b.skip) / b.scored.length) : 0,
        conflicts: conflictMap.get(key) ?? 0,
      });
    }
    return out;
  },
  ["brand-index-v2"],
  { revalidate: 86400 },
);

export async function getBrandIndex(): Promise<BrandSummary[]> {
  return loadIndex();
}

type ProductRow = {
  id: string; slug: string; name: string; brand: string; image_urls: string[] | null; ocr_image_url: string | null;
  price_inr: string | null; mrp_inr: string | null; net_weight: string | null; category: string | null; subcategory: string | null;
  score: string | null; protein: string | null; sugar: string | null; kcal: string | null; variant_key: string | null;
  category_rank: number | null; category_size: number | null; category_label: string | null;
};

function toCard(r: ProductRow): SearchCard {
  const score = r.score == null ? null : Math.round(Number(r.score));
  const num = (v: string | null) => (v == null ? null : Number(v));
  return {
    id: r.id, slug: r.slug, name: r.name, brand: r.brand,
    image: normalizeProductImageUrls(r.image_urls ?? [], { ocrImageUrl: r.ocr_image_url })[0] ?? null,
    price_inr: num(r.price_inr), mrp_inr: num(r.mrp_inr), net_weight: r.net_weight, price_per_100: null,
    score,
    verdict: score == null ? null : resolveProductVerdict({ score, name: r.name, category: r.category, subcategory: r.subcategory }),
    rank: r.category_rank && r.category_size ? { rank: r.category_rank, size: r.category_size, label: r.category_label } : null,
    reasons: [], warning: null, fit: null, sizes: [],
    nutrition: { protein_g: num(r.protein), sugar_g: num(r.sugar), kcal: num(r.kcal) },
  };
}

const loadBrand = unstable_cache(
  async (slug: string): Promise<BrandDetail | null> => {
    const summary = (await loadIndex()).find(b => b.slug === slug);
    if (!summary) return null;
    const sql = searchSql();
    const key = summary.key;
    const rows = await sql<ProductRow[]>`
      select p.id, p.slug, p.name, p.brand, p.image_urls, p.ocr_image_url, p.price_inr, p.mrp_inr, p.net_weight,
             p.category, p.subcategory, coalesce(si.absolute_score, si.scout_score) score,
             si.protein_g protein, si.sugar_g sugar, si.energy_kcal kcal, f.variant_key,
             si.category_rank, si.category_size, si.category_label
      from products p
      left join product_search_index si on si.product_id = p.id
      left join product_facts f on f.product_id = p.id
      where p.catalog_visible and lower(p.brand) = ${key}
      order by coalesce(si.absolute_score, si.scout_score) desc nulls last, p.price_inr`;

    // One card per pack-size group; the best-scoring size represents it.
    const groups = new Map<string, { card: SearchCard; aisle: string }>();
    for (const r of rows) {
      const k = r.variant_key ?? r.id;
      const size = { slug: r.slug, net_weight: r.net_weight, price_inr: r.price_inr == null ? null : Number(r.price_inr) };
      const g = groups.get(k);
      if (g) g.card.sizes.push(size);
      else groups.set(k, { card: { ...toCard(r), sizes: [size] }, aisle: r.subcategory ?? r.category ?? "Other" });
    }
    for (const g of groups.values()) {
      g.card.sizes.sort((a, b) => (a.price_inr ?? Infinity) - (b.price_inr ?? Infinity));
      if (g.card.sizes.length < 2) g.card.sizes = [];
    }
    const cards = [...groups.values()];
    const scored = cards.filter(c => c.card.score != null).map(c => c.card);

    const byAisle = new Map<string, SearchCard[]>();
    for (const c of cards) byAisle.set(c.aisle, [...(byAisle.get(c.aisle) ?? []), c.card]);
    const aisles = [...byAisle].map(([aisle, items]) => ({ aisle, items })).sort((a, b) => b.items.length - a.items.length || a.aisle.localeCompare(b.aisle));

    const conflictRows = await sql<{ id: string; slug: string; name: string; brand: string; image_urls: string[] | null; ocr_image_url: string | null; price_inr: string | null; net_weight: string | null; score: string | null; claim: string; reality: string; kind: string; severity: "high" | "medium" }[]>`
      select p.id, p.slug, p.name, p.brand, p.image_urls, p.ocr_image_url, p.price_inr, p.net_weight,
             coalesce(si.absolute_score, si.scout_score) score, lc.claim, lc.reality, lc.kind, lc.severity
      from label_conflicts lc
      join products p on p.id = lc.product_id and p.catalog_visible
      left join product_search_index si on si.product_id = p.id
      where lower(p.brand) = ${key}
      order by lc.severity, p.name`;
    const conflictCards: LabelConflict[] = conflictRows.map(r => ({
      id: r.id, slug: r.slug, name: r.name, brand: r.brand,
      image: normalizeProductImageUrls(r.image_urls ?? [], { ocrImageUrl: r.ocr_image_url })[0] ?? null,
      price_inr: r.price_inr == null ? null : Number(r.price_inr), net_weight: r.net_weight,
      score: r.score == null ? null : Math.round(Number(r.score)),
      claim: r.claim, reality: r.reality, kind: r.kind, severity: r.severity,
    }));

    const good = scored.filter(c => c.verdict === "daily_staple" || c.verdict === "good_choice").length;
    return {
      ...summary,
      stapleOrGoodPct: scored.length ? Math.round((100 * good) / scored.length) : 0,
      best: scored.slice(0, 6),
      worst: scored.length > 9 ? scored.slice(-3).reverse() : [],
      aisles,
      conflictCards,
    };
  },
  ["brand-detail-v2"],
  { revalidate: 86400 },
);

export async function getBrand(slug: string): Promise<BrandDetail | null> {
  return loadBrand(slug);
}
