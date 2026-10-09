/**
 * Insights computed from product facts (lib/facts) and verified label conflicts.
 * Every number is a plain count over visible products, so it can be traced back
 * to individual labels. Cached for a day; one card per pack-size group.
 */
import { unstable_cache } from "next/cache";
import { searchSql } from "@/lib/search/planned/db";
import { normalizeProductImageUrls } from "@/lib/products/catalog-hero-image";

export type InsightProduct = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  price_inr: number | null;
  net_weight: string | null;
  score: number | null;
};

export type LabelConflict = InsightProduct & { claim: string; reality: string; kind: string; severity: "high" | "medium" };

export type IngredientStat = { concept: string; label: string; pct: number; count: number };
export type AisleStat = { aisle: string; total: number; pct: number; example: InsightProduct | null };
export type AisleBest = { aisle: string; total: number; best: InsightProduct };

export type InsightsData = {
  total: number;
  ingredientStats: IngredientStat[];
  claimers: number;
  conflictedProducts: number;
  conflictsByKind: { kind: string; count: number }[];
  /** Brand-capped selection for the story section. */
  conflicts: LabelConflict[];
  /** Every verified conflict, one per product line. */
  allConflicts: LabelConflict[];
  sugarByAisle: AisleStat[];
  palmByAisle: AisleStat[];
  bestByAisle: AisleBest[];
};

const FREE_FROM_CLAIMS = ["gluten_free", "no_palm_oil", "no_added_sugar", "sugar_free", "no_preservatives", "no_artificial_colours", "no_artificial_flavours", "no_maida", "vegan", "lactose_free"];
const STAT_CONCEPTS: [string, string][] = [
  ["added_sugar", "contain added sugar"],
  ["palm_oil", "contain palm oil"],
  ["refined_flour", "are made with maida"],
  ["preservative", "contain preservatives"],
  ["flavour_enhancer", "contain MSG-type flavour enhancers"],
  ["artificial_colour", "contain synthetic colours"],
];

type Row = { id: string; slug: string; name: string; brand: string | null; image_urls: string[] | null; ocr_image_url: string | null; price_inr: string | null; net_weight: string | null; score: string | null };

function toProduct(r: Row): InsightProduct {
  const images = normalizeProductImageUrls(r.image_urls ?? [], { ocrImageUrl: r.ocr_image_url });
  return {
    id: r.id, slug: r.slug, name: r.name, brand: r.brand, image: images[0] ?? null,
    price_inr: r.price_inr == null ? null : Number(r.price_inr), net_weight: r.net_weight,
    score: r.score == null ? null : Math.round(Number(r.score)),
  };
}

async function load(): Promise<InsightsData> {
  const sql = searchSql();
  const [counts] = await sql<{ total: number; complete: number; claimers: number; conflicted: number; [k: string]: number }[]>`
    select count(*)::int total,
      count(*) filter (where f.ingredient_status = 'complete')::int complete,
      count(*) filter (where f.claims && ${FREE_FROM_CLAIMS}::text[])::int claimers,
      (select count(distinct product_id)::int from label_conflicts) conflicted,
      ${sql.unsafe(STAT_CONCEPTS.map(([c]) => `count(*) filter (where f.ingredient_status = 'complete' and '${c}' = any(f.present))::int as "${c}"`).join(", "))}
    from products p join product_facts f on f.product_id = p.id
    where p.catalog_visible`;

  const conflictRows = await sql<(Row & { claim: string; reality: string; kind: string; severity: "high" | "medium"; variant_key: string | null; brand_size: number })[]>`
    select p.id, p.slug, p.name, p.brand, p.image_urls, p.ocr_image_url, p.price_inr, p.net_weight, coalesce(si.absolute_score, si.scout_score) score,
           lc.claim, lc.reality, lc.kind, lc.severity, f.variant_key,
           (select count(*) from products b where b.brand = p.brand and b.catalog_visible)::int brand_size
    from label_conflicts lc
    join products p on p.id = lc.product_id and p.catalog_visible
    join product_facts f on f.product_id = p.id
    left join product_search_index si on si.product_id = p.id
    where cardinality(p.image_urls) > 0
    order by brand_size desc, p.name`;
  // One card per product line, at most two per brand, so no brand dominates the story.
  const seenKey = new Set<string>(), perBrand = new Map<string, number>();
  const ranked: LabelConflict[] = [], allConflicts: LabelConflict[] = [];
  for (const r of conflictRows) {
    const key = `${r.variant_key ?? r.id}|${r.claim}`, brand = (r.brand ?? "").toLowerCase();
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    const c: LabelConflict = { ...toProduct(r), claim: r.claim, reality: r.reality, kind: r.kind, severity: r.severity };
    allConflicts.push(c);
    if ((perBrand.get(brand) ?? 0) >= 2 || ranked.some(x => x.id === c.id)) continue;
    perBrand.set(brand, (perBrand.get(brand) ?? 0) + 1);
    ranked.push(c);
  }
  // Interleave claim types (most common first) so the story isn't ten sugar cases in a row;
  // within a type, better-known brands come first (rows arrive ordered by brand size).
  const byKind = new Map<string, LabelConflict[]>();
  for (const c of ranked) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const kinds = [...byKind.keys()].sort((a, b) => byKind.get(b)!.length - byKind.get(a)!.length);
  const conflicts: LabelConflict[] = [];
  for (let i = 0; conflicts.length < ranked.length; i++) {
    for (const k of kinds) { const c = byKind.get(k)![i]; if (c) conflicts.push(c); }
  }
  const conflictsByKind = await sql<{ kind: string; count: number }[]>`
    select kind, count(distinct product_id)::int count from label_conflicts lc
    join products p on p.id = lc.product_id and p.catalog_visible group by kind order by count desc`;

  const byAisle = async (concept: string): Promise<AisleStat[]> => {
    const rows = await sql<(Row & { aisle: string; total: number; pct: number })[]>`
      with a as (
        select p.subcategory aisle, count(*)::int total,
          round(100.0 * count(*) filter (where ${concept} = any(f.present)) / count(*), 0)::int pct
        from products p join product_facts f on f.product_id = p.id
        where p.catalog_visible and f.ingredient_status = 'complete' and p.subcategory is not null
        group by 1 having count(*) >= 25
      ), ex as (
        select distinct on (p.subcategory) p.subcategory aisle, p.id, p.slug, p.name, p.brand, p.image_urls, p.ocr_image_url,
               p.price_inr, p.net_weight, coalesce(si.absolute_score, si.scout_score) score
        from products p join product_facts f on f.product_id = p.id
        left join product_search_index si on si.product_id = p.id
        where p.catalog_visible and ${concept} = any(f.present) and cardinality(p.image_urls) > 0
        order by p.subcategory, coalesce(si.absolute_score, si.scout_score) desc nulls last
      )
      select a.aisle, a.total, a.pct, ex.id, ex.slug, ex.name, ex.brand, ex.image_urls, ex.ocr_image_url, ex.price_inr, ex.net_weight, ex.score
      from a left join ex on ex.aisle = a.aisle
      order by a.pct desc, a.total desc limit 10`;
    return rows.map(r => ({ aisle: r.aisle, total: r.total, pct: r.pct, example: r.id ? toProduct(r) : null }));
  };

  const bestRows = await sql<(Row & { aisle: string; total: number })[]>`
    with ranked as (
      select p.subcategory aisle, p.id, p.slug, p.name, p.brand, p.image_urls, p.ocr_image_url, p.price_inr, p.net_weight,
             coalesce(si.absolute_score, si.scout_score) score, count(*) over (partition by p.subcategory)::int total,
             row_number() over (partition by p.subcategory order by coalesce(si.absolute_score, si.scout_score) desc nulls last, p.price_inr) rn
      from products p join product_search_index si on si.product_id = p.id
      left join product_facts f on f.product_id = p.id
      where p.catalog_visible and coalesce(si.absolute_score, si.scout_score) is not null and cardinality(p.image_urls) > 0
        and not coalesce(f.nutrition_suspect, false)
    )
    select * from ranked where rn = 1 and total >= 40 order by total desc limit 12`;

  return {
    total: counts!.total,
    // Percentages use complete ingredient lists only; unreadable labels are not guessed.
    ingredientStats: STAT_CONCEPTS.map(([c, label]) => ({ concept: c, label, count: counts![c]!, pct: Math.round((100 * counts![c]!) / counts!.complete) })),
    claimers: counts!.claimers,
    conflictedProducts: counts!.conflicted,
    conflictsByKind,
    conflicts,
    allConflicts,
    sugarByAisle: await byAisle("added_sugar"),
    palmByAisle: await byAisle("palm_oil"),
    bestByAisle: bestRows.map(r => ({ aisle: r.aisle, total: r.total, best: toProduct(r) })),
  };
}

export const getInsights = unstable_cache(load, ["insights-facts-v1"], { revalidate: 86_400, tags: ["insights"] });

export const CONFLICT_KIND_LABELS: Record<string, string> = {
  sugar: "Sugar", gluten: "Gluten", palm_oil: "Palm oil", preservative: "Preservatives", colour: "Colours",
  flavour: "Flavours", msg: "MSG", trans_fat: "Trans fat", egg: "Egg", dairy: "Dairy", maida: "Maida",
  sweetener: "Sweeteners", other: "Other",
};
