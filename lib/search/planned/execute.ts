/**
 * Plan executor: hard filters and ordering in SQL over the whole visible
 * catalog, then per-item confirmation from product facts.
 *
 * Constraint semantics
 *   exclude concept   present -> dropped; may_contain -> dropped if strict, else flagged;
 *                     unknown (or no facts yet) -> kept as "unconfirmed"
 *   require concept   present -> ok; unknown -> unconfirmed; absent -> dropped
 *   diet / numeric    missing data -> unconfirmed, never silently passed
 * Confirmed items always rank above unconfirmed ones.
 */
import type { ConceptId, NumericField } from "@/lib/facts/vocab";
import type { Sql } from "./db";
import type { NumericFilter, SearchPlan } from "./plan";
import type { CatalogVocabulary } from "./vocabulary";

/** Approximate number of visible products in the plan's scope. */
export function scopeSize(plan: SearchPlan, vocab: CatalogVocabulary | null, useScope: boolean): number {
  if (!vocab) return Number.MAX_SAFE_INTEGER;
  const all = [...vocab.l3.values()];
  if (!useScope || (!plan.l3.length && !plan.subcategories.length && !plan.categories.length)) {
    return all.reduce((n, x) => n + x.count, 0);
  }
  const l3 = new Set(plan.l3), subs = new Set(plan.subcategories), cats = new Set(plan.categories);
  return all.filter(x => l3.has(`${x.subcategory} > ${x.l3}`) || subs.has(x.subcategory) || cats.has(x.category))
    .reduce((n, x) => n + x.count, 0);
}

/** Widen scope one level (l3 -> subcategory -> category); never to the whole catalog. */
export function widenScope(plan: SearchPlan, vocab: CatalogVocabulary | null): SearchPlan | null {
  if (!vocab) return null;
  if (plan.l3.length) {
    const subs = new Set(plan.subcategories);
    for (const q of plan.l3) { const node = vocab.l3.get(q); if (node) subs.add(node.subcategory); }
    return { ...plan, l3: [], subcategories: [...subs] };
  }
  if (plan.subcategories.length) {
    const cats = new Set(plan.categories);
    for (const s of plan.subcategories) { const c = vocab.subcategories.get(s); if (c) cats.add(c); }
    return { ...plan, subcategories: [], categories: [...cats] };
  }
  return null;
}

export type Confirmation = "confirmed" | "unconfirmed";

export type PlannedItem = {
  product_id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  l3: string | null;
  price_inr: number | null;
  net_weight: string | null;
  scout_score: number | null;
  nutrition: Record<string, number | string | null> | null;
  kind: string | null;
  ingredients: string[];
  claims: string[];
  present: string[];
  may_contain: string[];
  unknown: string[];
  conflicts: string[];
  ingredient_status: string | null;
  veg: string | null;
  vegan: boolean | null;
  jain: boolean | null;
  price_per_100: number | null;
  evidence: Record<string, string>;
  variant_key: string | null;
  display: {
    image_urls: string[]; mrp_inr: number | null; ocr_image_url: string | null; primary_type: string | null;
    absolute_score: number | null; category_rank: number | null; category_size: number | null; category_label: string | null;
  };
  similarity: number | null;
  lexical: number;
  confirmation: Confirmation;
  notes: string[];
  score: number;
};

export type ExecuteResult = {
  items: PlannedItem[];
  relaxed: string[];
  counts: { step: string; matched: number; confirmed: number }[];
  reference: { query: string; value: number; products: string[] } | null;
  ms: number;
};

const NUTRI: Record<string, string> = {
  energy_kcal: "energy_kcal_100g", protein_g: "protein_g_100g", sugar_g: "sugar_g_100g",
  added_sugar_g: "added_sugar_g_100g", fat_g: "fat_g_100g", saturated_fat_g: "saturated_fat_g_100g",
  carbs_g: "carbs_g_100g", fiber_g: "fiber_g_100g", sodium_mg: "sodium_mg_100g",
};

/** Label physics: macros cannot exceed 100 g and energy must roughly equal 4p + 4c + 9f. */
const NUTRITION_PLAUSIBLE = `(
  not coalesce(f.nutrition_suspect, false)
  and coalesce((p.nutrition->>'protein_g_100g')::numeric, 0) + coalesce((p.nutrition->>'fat_g_100g')::numeric, 0)
    + coalesce((p.nutrition->>'carbs_g_100g')::numeric, 0) <= 105
  and (p.nutrition->>'energy_kcal_100g' is null or p.nutrition->>'protein_g_100g' is null
    or p.nutrition->>'fat_g_100g' is null or p.nutrition->>'carbs_g_100g' is null
    or abs(4 * (p.nutrition->>'protein_g_100g')::numeric + 4 * (p.nutrition->>'carbs_g_100g')::numeric
      + 9 * (p.nutrition->>'fat_g_100g')::numeric - (p.nutrition->>'energy_kcal_100g')::numeric)
      <= 0.35 * (p.nutrition->>'energy_kcal_100g')::numeric + 25))`;
const NUTRITION_FIELDS = new Set<NumericField>(["energy_kcal", "protein_g", "sugar_g", "added_sugar_g", "fat_g", "saturated_fat_g", "carbs_g", "fiber_g", "sodium_mg", "protein_per_100kcal"]);

/** Whitelisted SQL expression per numeric field (never interpolate model output). */
function fieldExpr(field: NumericField): string {
  if (field === "price_inr") return "nullif(p.price_inr, 0)";
  if (field === "price_per_100") return "f.price_per_100";
  if (field === "pack_qty") return "f.pack_qty";
  if (field === "scout_score") return "coalesce(si.absolute_score, si.scout_score)";
  if (field === "protein_per_100kcal") {
    return "((p.nutrition->>'protein_g_100g')::numeric * 100 / nullif((p.nutrition->>'energy_kcal_100g')::numeric, 0))";
  }
  const key = NUTRI[field];
  if (!key) throw new Error(`Unknown numeric field ${field}`);
  return `(p.nutrition->>'${key}')::numeric`;
}

function numericValue(item: PlannedItem, field: NumericField): number | null {
  if (field === "price_inr") return item.price_inr;
  if (field === "price_per_100") return item.price_per_100;
  if (field === "scout_score") return item.scout_score;
  const n = item.nutrition ?? {};
  const num = (k: string) => (n[k] == null || n[k] === "" ? null : Number(n[k]));
  if (field === "protein_per_100kcal") {
    const p = num("protein_g_100g"), e = num("energy_kcal_100g");
    return p != null && e ? (p * 100) / e : null;
  }
  if (field === "pack_qty") return null;
  return num(NUTRI[field]!);
}

const SHORTLIST = 200;
const RELAX_SIMILARITY_MARGIN = 0.1;

type Attempt = {
  plan: SearchPlan;
  scopeSize: number;
  useScope: boolean;
  useBrands: boolean;
  useNameTerms: boolean;
  useClaimsRequired: boolean;
  numeric: NumericFilter[];
};

function nameTermPattern(term: string): string {
  // "haldi|turmeric" = alternatives. Prefix match on word boundary, tolerant of
  // plural/suffix forms ("strawberr" ~ strawberries).
  const alts = term.toLowerCase().split("|").map(t => t.replace(/[^a-z0-9 ]/g, "").trim().replace(/(ies|es|s)$/, "")).filter(Boolean);
  return `\\m(${alts.join("|")})`;
}

async function runAttempt(sql: Sql, a: Attempt, embedding: number[] | null, limit: number): Promise<PlannedItem[]> {
  const { plan } = a;
  const conds: string[] = ["p.catalog_visible"];
  const params: unknown[] = [];
  const param = (v: unknown, cast = "") => { params.push(v); return `$${params.length}${cast}`; };

  if (a.useScope && (plan.l3.length || plan.subcategories.length || plan.categories.length)) {
    const ors: string[] = [];
    if (plan.l3.length) ors.push(`(p.subcategory || ' > ' || p.l3_category) = any(${param(plan.l3, "::text[]")})`);
    if (plan.subcategories.length) ors.push(`p.subcategory = any(${param(plan.subcategories, "::text[]")})`);
    if (plan.categories.length) ors.push(`p.category = any(${param(plan.categories, "::text[]")})`);
    conds.push(`(${ors.join(" or ")})`);
  }
  if (a.useBrands && plan.brands.length) {
    // Brand families: "Cadbury" also covers "Cadbury CHOCOBAKES" and "Cadbury Bournvita".
    const b = param(plan.brands, "::text[]");
    conds.push(`(p.brand = any(${b}) or exists (select 1 from unnest(${b}) x where p.brand ilike x || ' %'))`);
  }
  if (a.useNameTerms) {
    for (const t of plan.name_terms) {
      conds.push(`(p.name || ' ' || coalesce(f.kind, '')) ~* ${param(nameTermPattern(t))}`);
    }
  }
  if (plan.exclude.length) {
    const ex = param(plan.exclude, "::text[]");
    conds.push(`not coalesce(f.present && ${ex}, false)`);
    if (plan.strict) conds.push(`not coalesce(f.may_contain && ${ex}, false)`);
  }
  if (plan.require.length) {
    // Each required concept must be present or unknown; absent drops the product.
    const req = param(plan.require, "::text[]");
    conds.push(`(f.product_id is null or not exists (select 1 from unnest(${req}) c where not (c = any(f.present) or c = any(f.unknown) or c = any(f.may_contain))))`);
  }
  if (a.useClaimsRequired && plan.claims_required.length) {
    conds.push(`coalesce(f.claims @> ${param(plan.claims_required, "::text[]")}, false)`);
  }
  if (plan.diet.veg) conds.push(`coalesce(f.veg, 'unknown') in ('veg', 'unknown')`);
  if (plan.diet.vegan) conds.push(`coalesce(f.vegan, true)`);
  if (plan.diet.jain) conds.push(`coalesce(f.jain, true)`);
  for (const n of a.numeric) {
    // Missing values survive here and are marked unconfirmed afterwards.
    conds.push(`(${fieldExpr(n.field)} is null or ${fieldExpr(n.field)} ${n.op} ${param(n.value, "::numeric")})`);
  }

  const emb = embedding ? param(`[${embedding.join(",")}]`, "::vector") : null;
  const lexQuery = param(plan.semantic_query || "");
  const sortExpr = plan.sort.field === "relevance" ? null : fieldExpr(plan.sort.field);
  // Stage 1 picks candidate ids without touching the 4 KB TOASTed embeddings:
  // relevance ranks by Hamming distance over the inline 128-byte bits in
  // product_facts; numeric sorts never need vectors. Stage 2 loads full rows and
  // exact cosine for the shortlist only.
  const nutrientSort = sortExpr != null && NUTRITION_FIELDS.has(plan.sort.field as NumericField);
  const qbits = emb ? `binary_quantize(${emb})::bit(1024)` : null;
  const stage1Order = sortExpr
    ? `${nutrientSort ? `(${NUTRITION_PLAUSIBLE}) desc, ` : ""}(${sortExpr}) is null, ${sortExpr} ${plan.sort.dir}`
    : qbits ? `f.embedding_bits <~> ${qbits} nulls last` : `ts_rank_cd(si.search_tsv, plainto_tsquery('simple', ${lexQuery})) desc`;
  const stage1Limit = sortExpr ? Math.max(limit * 3, 150) : SHORTLIST;
  const order = sortExpr
    ? `${nutrientSort ? "nutrition_ok desc, " : ""}sort_value is null, sort_value ${plan.sort.dir}, relevance desc`
    : "relevance desc";
  const similarity = emb ? `1 - (si.embedding <=> ${emb})` : "null::float8";

  const text = `
    with ids as materialized (
      select p.id, ${sortExpr ?? "null::numeric"} as sort_value
      from products p
      join product_search_index si on si.product_id = p.id
      left join product_facts f on f.product_id = p.id
      where ${conds.join("\n        and ")}
      order by ${stage1Order}
      limit ${stage1Limit}
    ), cand as (
      select p.id, p.slug, p.name, p.brand, p.category, p.subcategory, p.l3_category, p.price_inr,
             p.net_weight, p.nutrition, coalesce(si.absolute_score, si.scout_score) scout_score, p.image_urls, p.mrp_inr, p.ocr_image_url,
             si.primary_type, si.absolute_score, si.category_rank, si.category_size, si.category_label,
             f.product_id as f_id, f.kind, f.ingredients, f.claims, f.present, f.may_contain, f.unknown,
             f.conflicts, f.ingredient_status, f.veg, f.vegan, f.jain, f.price_per_100, f.evidence, f.variant_key,
             ids.sort_value, ${NUTRITION_PLAUSIBLE} as nutrition_ok,
             ${similarity} as similarity,
             ts_rank_cd(si.search_tsv, plainto_tsquery('simple', ${lexQuery})) +
               ts_rank_cd(si.search_tsv, websearch_to_tsquery('simple', replace(${lexQuery}, ' ', ' or '))) as lexical
      from ids
      join products p on p.id = ids.id
      join product_search_index si on si.product_id = p.id
      left join product_facts f on f.product_id = p.id
    )
    select *, coalesce(similarity, 0) * 1.0 + least(lexical, 1) * 0.15 as relevance
    from cand
    order by ${order}
    limit ${Math.max(1, Math.min(400, limit))}`;

  const rows = await sql.unsafe(text, params as never[]);
  return rows.map(r => ({
    product_id: r.id, slug: r.slug, name: r.name, brand: r.brand, category: r.category,
    subcategory: r.subcategory, l3: r.l3_category,
    price_inr: r.price_inr == null ? null : Number(r.price_inr),
    net_weight: r.net_weight, scout_score: r.scout_score == null ? null : Number(r.scout_score),
    nutrition: r.nutrition, kind: r.kind, ingredients: r.ingredients ?? [], claims: r.claims ?? [],
    present: r.present ?? [], may_contain: r.may_contain ?? [], unknown: r.unknown ?? [],
    conflicts: r.conflicts ?? [], ingredient_status: r.ingredient_status, veg: r.veg, vegan: r.vegan,
    jain: r.jain, price_per_100: r.price_per_100 == null ? null : Number(r.price_per_100),
    evidence: r.evidence ?? {},
    variant_key: r.variant_key ?? null,
    display: {
      image_urls: r.image_urls ?? [], mrp_inr: r.mrp_inr == null ? null : Number(r.mrp_inr),
      ocr_image_url: r.ocr_image_url ?? null, primary_type: r.primary_type ?? null,
      absolute_score: r.absolute_score == null ? null : Number(r.absolute_score),
      category_rank: r.category_rank == null ? null : Number(r.category_rank),
      category_size: r.category_size == null ? null : Number(r.category_size),
      category_label: r.category_label ?? null,
    },
    similarity: r.similarity == null ? null : Number(r.similarity),
    lexical: Number(r.lexical ?? 0), confirmation: "confirmed", notes: [], score: Number(r.relevance ?? 0),
    hasFacts: r.f_id != null, nutritionOk: r.nutrition_ok !== false,
  } as PlannedItem & { hasFacts: boolean }));
}

/** Mark each item confirmed/unconfirmed and explain why. */
export function confirm(item: PlannedItem & { hasFacts?: boolean; nutritionOk?: boolean }, plan: SearchPlan, numeric: NumericFilter[]): PlannedItem {
  const notes: string[] = [];
  const usesNutrition = numeric.some(n => NUTRITION_FIELDS.has(n.field)) || NUTRITION_FIELDS.has(plan.sort.field as NumericField);
  if (usesNutrition && item.nutritionOk === false) notes.push("nutrition label looks inconsistent");
  const hasFacts = item.hasFacts !== false;
  const state = (c: ConceptId) =>
    !hasFacts ? "unknown"
      : item.present.includes(c) ? "present"
        : item.may_contain.includes(c) ? "may_contain"
          : item.unknown.includes(c) ? "unknown" : "absent";
  for (const c of plan.exclude) {
    const s = state(c);
    if (s === "unknown") notes.push(`label doesn't confirm no ${c.replace(/_/g, " ")}${item.evidence[c] ? ` (${item.evidence[c]})` : ""}`);
    if (s === "may_contain") notes.push(`may contain ${c.replace(/_/g, " ")}`);
  }
  for (const c of plan.require) if (state(c) !== "present") notes.push(`label doesn't confirm ${c.replace(/_/g, " ")}`);
  if (plan.diet.veg && (!hasFacts || item.veg !== "veg")) notes.push("veg status not confirmed");
  if (plan.diet.vegan && item.vegan !== true) notes.push("vegan status not confirmed");
  if (plan.diet.jain && item.jain !== true) notes.push("jain status not confirmed");
  for (const n of numeric) if (numericValue(item, n.field) == null) notes.push(`${n.field.replace(/_/g, " ")} not on label`);
  // may_contain under a non-strict exclusion is a warning, not a failure.
  const blocking = notes.filter(n => !n.startsWith("may contain"));
  const { hasFacts: _drop, nutritionOk: _ok, ...rest } = item as PlannedItem & { hasFacts?: boolean; nutritionOk?: boolean };
  void _drop; void _ok;
  return { ...rest, notes, confirmation: blocking.length ? "unconfirmed" : "confirmed" };
}

function rank(items: PlannedItem[], plan: SearchPlan): PlannedItem[] {
  const pref = new Set(plan.claims_preferred);
  const scored = items.map(it => {
    let s = it.score;
    for (const c of it.claims) if (pref.has(c as never)) s += 0.04;
    if (it.conflicts.length) s -= 0.05;
    // Goals care about healthiness as part of fit; plain product queries barely.
    if (it.scout_score != null) s += (it.scout_score / 100) * (plan.intent === "goal" ? 0.15 : 0.03);
    return { ...it, score: s };
  });
  // SQL already applied the requested sort; only reorder relevance-sorted results.
  const ordered = plan.sort.field === "relevance" ? [...scored].sort((a, b) => b.score - a.score) : scored;
  return [...ordered.filter(i => i.confirmation === "confirmed"), ...ordered.filter(i => i.confirmation !== "confirmed")];
}

async function resolveReference(sql: Sql, plan: SearchPlan, embedding: number[] | null): Promise<ExecuteResult["reference"]> {
  if (!plan.comparison) return null;
  const { reference, field } = plan.comparison;
  const words = reference.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
  if (!words.length) return null;
  const params: unknown[] = [];
  const conds = words.map(w => { params.push(`\\m${w}`); return `(p.name || ' ' || coalesce(p.brand, '')) ~* $${params.length}`; });
  // Require most words to match; reference products are usually named outright ("maggi").
  const need = Math.max(1, Math.ceil(words.length * 0.6));
  const expr = fieldExpr(field);
  void embedding;
  const rows = await sql.unsafe(`
    select p.name, ${expr} as v from products p
    join product_search_index si on si.product_id = p.id
    left join product_facts f on f.product_id = p.id
    where p.catalog_visible and ${expr} is not null
      and (${conds.map(c => `(${c})::int`).join(" + ")}) >= ${need}
    order by (${conds.map(c => `(${c})::int`).join(" + ")}) desc, p.name
    limit 8`, params as never[]);
  if (!rows.length) return null;
  const values = rows.map(r => Number(r.v)).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)]!;
  return { query: reference, value: median, products: rows.map(r => r.name as string) };
}

export async function executePlan(sql: Sql, plan: SearchPlan, embedding: number[] | null, opts: { limit?: number; minConfirmed?: number; vocab?: CatalogVocabulary | null } = {}): Promise<ExecuteResult> {
  const vocab = opts.vocab ?? null;
  const started = Date.now();
  const limit = opts.limit ?? 24;
  const minConfirmed = opts.minConfirmed ?? 3;
  const reference = await resolveReference(sql, plan, embedding);
  const baseNumeric = [...plan.numeric];
  if (plan.comparison && reference) {
    baseNumeric.push({ field: plan.comparison.field, op: plan.comparison.dir === "higher" ? ">" : "<", value: reference.value });
  }
  let attempt: Attempt = { plan, scopeSize: scopeSize(plan, vocab, true), useScope: true, useBrands: true, useNameTerms: true, useClaimsRequired: true, numeric: baseNumeric };
  const relaxed: string[] = [];
  const counts: ExecuteResult["counts"] = [];
  const pool = Math.max(limit * 4, 60);

  const run = async (step: string) => {
    const raw = await runAttempt(sql, attempt, embedding, pool);
    const items = rank(raw.map(i => confirm(i, plan, attempt.numeric)), plan);
    counts.push({ step, matched: items.length, confirmed: items.filter(i => i.confirmation === "confirmed").length });
    return items;
  };

  let items = await run("initial");
  // Widening scope one level is always available as the last resort.
  // Up to two widening steps: l3 -> subcategory -> category.
  const relaxOrder = [...plan.relax.filter(k => k !== "scope"), "scope", "scope"];
  for (const key of relaxOrder) {
    // Count distinct products, not pack sizes of the same one.
    if (new Set(items.filter(i => i.confirmation === "confirmed").map(i => i.variant_key ?? i.product_id)).size >= minConfirmed) break;
    const next = { ...attempt };
    if (key === "scope") {
      const wider = widenScope(attempt.plan, vocab);
      if (!wider) continue;
      next.plan = wider;
    }
    else if (key === "brands") next.useBrands = false;
    else if (key === "name_terms") next.useNameTerms = false;
    else if (key === "claims_required") next.useClaimsRequired = false;
    else if (key.startsWith("numeric:")) next.numeric = attempt.numeric.filter(n => `numeric:${n.field}` !== key);
    else continue;
    if (JSON.stringify(next) === JSON.stringify(attempt)) continue;
    next.scopeSize = scopeSize(next.plan, vocab, next.useScope);
    attempt = next;
    let relaxedItems = await run(key);
    if (key === "scope") {
      // A wider scope must not drag in unrelated products: stay near the best match.
      const best = Math.max(...relaxedItems.map(i => i.similarity ?? 0), 0);
      relaxedItems = relaxedItems.filter(i => i.similarity == null || i.similarity >= best - RELAX_SIMILARITY_MARGIN);
    }
    // Keep the stricter results first; relaxation only adds what is missing.
    const seen = new Set(items.map(i => i.product_id));
    items = [...items, ...relaxedItems.filter(i => !seen.has(i.product_id)).map(i => ({ ...i, notes: [...i.notes, `relaxed ${key.replace("numeric:", "")}`] }))];
    relaxed.push(key);
  }
  return { items: items.slice(0, pool), relaxed, counts, reference, ms: Date.now() - started };
}
