/**
 * Live catalog vocabulary for the planner: every visible l3 category grouped
 * under its subcategory, and the brand list. Loaded from the DB and cached per
 * process; rendered deterministically so the planner prompt prefix stays
 * byte-identical (DeepSeek prompt caching).
 */
import type { Sql } from "./db";

export type CatalogVocabulary = {
  /** Keyed by the qualified name "Subcategory > l3" (l3 names repeat across subcategories). */
  l3: Map<string, { category: string; subcategory: string; l3: string; count: number }>;
  /** lowercased qualified name -> qualified name */
  l3Lower: Map<string, string>;
  /** lowercased bare l3 -> every qualified name carrying it */
  l3Bare: Map<string, string[]>;
  subcategories: Map<string, string>; // subcategory -> category
  categories: Set<string>;
  brands: { name: string; lower: string; count: number }[];
  rendered: string;
  loadedAt: number;
};

let cached: CatalogVocabulary | null = null;
const TTL_MS = 30 * 60_000;

export async function loadVocabulary(sql: Sql): Promise<CatalogVocabulary> {
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached;
  const rows = await sql<{ category: string; subcategory: string; l3: string; n: number }[]>`
    select category, subcategory, l3_category l3, count(*)::int n
    from products where catalog_visible and l3_category is not null
    group by 1, 2, 3 order by 1, 2, 3`;
  const brandRows = await sql<{ brand: string; n: number }[]>`
    select brand, count(*)::int n from products where catalog_visible and brand is not null
    group by 1 order by 1`;

  const l3 = new Map<string, { category: string; subcategory: string; l3: string; count: number }>();
  const l3Bare = new Map<string, string[]>();
  const subcategories = new Map<string, string>();
  const categories = new Set<string>();
  const grouped = new Map<string, string[]>();
  for (const r of rows) {
    const qualified = `${r.subcategory} > ${r.l3}`;
    l3.set(qualified, { category: r.category, subcategory: r.subcategory, l3: r.l3, count: r.n });
    l3Bare.set(r.l3.toLowerCase(), [...(l3Bare.get(r.l3.toLowerCase()) ?? []), qualified]);
    subcategories.set(r.subcategory, r.category);
    categories.add(r.category);
    const key = `${r.category} > ${r.subcategory}`;
    grouped.set(key, [...(grouped.get(key) ?? []), `${r.l3} (${r.n})`]);
  }
  const rendered = [...grouped.entries()].map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
  cached = {
    l3,
    l3Lower: new Map([...l3.keys()].map(k => [k.toLowerCase(), k])),
    l3Bare,
    subcategories,
    categories,
    brands: brandRows.map(b => ({ name: b.brand, lower: b.brand.toLowerCase(), count: b.n })),
    rendered,
    loadedAt: Date.now(),
  };
  return cached;
}

/** Brands whose name shares a token with the query (fuzzy, typo-tolerant). */
export function brandCandidates(vocab: CatalogVocabulary, query: string, limit = 12): string[] {
  const tokens = query.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 3);
  if (!tokens.length) return [];
  const scored: { name: string; score: number }[] = [];
  for (const b of vocab.brands) {
    const words = b.lower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    let score = 0;
    for (const t of tokens) {
      for (const w of words) {
        if (w === t) score += 3;
        else if (w.length >= 4 && (w.startsWith(t) || t.startsWith(w))) score += 2;
        else if (w.length >= 5 && t.length >= 5 && editDistance(w, t) <= 1) score += 1.5;
      }
    }
    if (score > 0) scored.push({ name: b.name, score: score + Math.log10(b.count + 1) * 0.1 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.name);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}
