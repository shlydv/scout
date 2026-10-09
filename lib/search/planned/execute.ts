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

/** Whitelisted SQL expression per numeric field (never interpolate model output). */
function fieldExpr(field: NumericField): string {
  if (field === "price_inr") return "p.price_inr";
  if (field === "price_per_100") return "f.price_per_100";
  if (field === "pack_qty") return "f.pack_qty";
  if (field === "scout_score") return "si.scout_score";
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

type Attempt = {
  plan: SearchPlan;
  useScope: boolean;
  useBrands: boolean;
  useNameTerms: boolean;
  useClaimsRequired: boolean;
  numeric: NumericFilter[];
};

function nameTermPattern(term: string): string {
  // Prefix match on word boundary, tolerant of plural/suffix forms ("strawberr" ~ strawberries).
  const stem = term.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/(ies|es|s)$/, "");
  return `\\m${stem}`;
}

async function runAttempt(sql: Sql, a: Attempt, embedding: number[] | null, limit: number): Promise<PlannedItem[]> {
  const { plan } = a;
  const conds: string[] = ["p.catalog_visible"];
  const params: unknown[] = [];
  const param = (v: unknown, cast = "") => { params.push(v); return `$${params.length}${cast}`; };

  if (a.useScope && (plan.l3.length || plan.subcategories.length || plan.categories.length)) {
    const ors: string[] = [];
    if (plan.l3.length) ors.push(`p.l3_category = any(${param(plan.l3, "::text[]")})`);
    if (plan.subcategories.length) ors.push(`p.subcategory = any(${param(plan.subcategories, "::text[]")})`);
    if (plan.categories.length) ors.push(`p.category = any(${param(plan.categories, "::text[]")})`);
    conds.push(`(${ors.join(" or ")})`);
  }
  if (a.useBrands && plan.brands.length) conds.push(`p.brand = any(${param(plan.brands, "::text[]")})`);
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
  const similarity = emb ? `1 - (si.embedding <=> ${emb})` : "null::float8";
  const sortExpr = plan.sort.field === "relevance" ? null : fieldExpr(plan.sort.field);
  const order = sortExpr
    ? `(${sortExpr}) is null, ${sortExpr} ${plan.sort.dir}, relevance desc`
    : "relevance desc";

  const text = `
    with cand as (
      select p.id, p.slug, p.name, p.brand, p.category, p.subcategory, p.l3_category, p.price_inr,
             p.net_weight, p.nutrition, si.scout_score,
             f.product_id as f_id, f.kind, f.ingredients, f.claims, f.present, f.may_contain, f.unknown,
             f.conflicts, f.ingredient_status, f.veg, f.vegan, f.jain, f.price_per_100, f.evidence,
             ${similarity} as similarity,
             ts_rank_cd(si.search_tsv, plainto_tsquery('simple', ${lexQuery})) +
               ts_rank_cd(si.search_tsv, websearch_to_tsquery('simple', replace(${lexQuery}, ' ', ' or '))) as lexical
      from products p
      join product_search_index si on si.product_id = p.id
      left join product_facts f on f.product_id = p.id
      where ${conds.join("\n        and ")}
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
    evidence: r.evidence ?? {}, similarity: r.similarity == null ? null : Number(r.similarity),
    lexical: Number(r.lexical ?? 0), confirmation: "confirmed", notes: [], score: Number(r.relevance ?? 0),
    hasFacts: r.f_id != null,
  } as PlannedItem & { hasFacts: boolean }));
}

/** Mark each item confirmed/unconfirmed and explain why. */
export function confirm(item: PlannedItem & { hasFacts?: boolean }, plan: SearchPlan, numeric: NumericFilter[]): PlannedItem {
  const notes: string[] = [];
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
  const { hasFacts: _drop, ...rest } = item as PlannedItem & { hasFacts?: boolean };
  void _drop;
  return { ...rest, notes, confirmation: blocking.length ? "unconfirmed" : "confirmed" };
}

function rank(items: PlannedItem[], plan: SearchPlan): PlannedItem[] {
  const pref = new Set(plan.claims_preferred);
  const scored = items.map(it => {
    let s = it.score;
    for (const c of it.claims) if (pref.has(c as never)) s += 0.04;
    if (it.conflicts.length) s -= 0.05;
    if (it.scout_score != null) s += (it.scout_score / 100) * 0.03;
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

export async function executePlan(sql: Sql, plan: SearchPlan, embedding: number[] | null, opts: { limit?: number; minConfirmed?: number } = {}): Promise<ExecuteResult> {
  const started = Date.now();
  const limit = opts.limit ?? 24;
  const minConfirmed = opts.minConfirmed ?? 3;
  const reference = await resolveReference(sql, plan, embedding);
  const baseNumeric = [...plan.numeric];
  if (plan.comparison && reference) {
    baseNumeric.push({ field: plan.comparison.field, op: plan.comparison.dir === "higher" ? ">" : "<", value: reference.value });
  }
  let attempt: Attempt = { plan, useScope: true, useBrands: true, useNameTerms: true, useClaimsRequired: true, numeric: baseNumeric };
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
  for (const key of plan.relax) {
    if (items.filter(i => i.confirmation === "confirmed").length >= minConfirmed) break;
    const next = { ...attempt };
    if (key === "scope") next.useScope = false;
    else if (key === "brands") next.useBrands = false;
    else if (key === "name_terms") next.useNameTerms = false;
    else if (key === "claims_required") next.useClaimsRequired = false;
    else if (key.startsWith("numeric:")) next.numeric = attempt.numeric.filter(n => `numeric:${n.field}` !== key);
    else continue;
    if (JSON.stringify(next) === JSON.stringify(attempt)) continue;
    attempt = next;
    const relaxedItems = await run(key);
    // Keep the stricter results first; relaxation only adds what is missing.
    const seen = new Set(items.map(i => i.product_id));
    items = [...items, ...relaxedItems.filter(i => !seen.has(i.product_id)).map(i => ({ ...i, notes: [...i.notes, `relaxed ${key.replace("numeric:", "")}`] }))];
    relaxed.push(key);
  }
  return { items: items.slice(0, pool), relaxed, counts, reference, ms: Date.now() - started };
}
