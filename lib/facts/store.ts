/** Persist product facts (shared by facts:load and facts:sync). */
import crypto from "node:crypto";
import type postgres from "postgres";
import { FACTS_MODEL, FACTS_VERSION, type FactsInput, type ProductFacts } from "./extract";
import { parsePack, pricePer100 } from "./pack";
import { variantKey } from "./variant-key";
import { CONCEPT_IDS } from "./vocab";

export type FactsSourceRow = FactsInput & { price_inr: string | number | null; net_weight: string | null };

/** Products as the facts pass sees them (inputs + what derived columns need). */
export async function loadFactsSources(sql: postgres.Sql, ids?: string[]): Promise<FactsSourceRow[]> {
  return sql<FactsSourceRow[]>`
    select p.id, p.name, p.brand, p.price_inr, p.net_weight,
           concat_ws(' > ', p.category, p.subcategory, p.l3_category) category_path,
           p.ingredients_raw,
           array_remove(array_cat(coalesce(si.claims, '{}'),
             array[p.attributes->>'Label Free From', p.attributes->>'Label Certifications']), null) label_claims
    from products p left join product_search_index si on si.product_id = p.id
    where p.catalog_visible ${ids ? sql`and p.id = any(${ids}::uuid[])` : sql``}
    order by p.id`;
}

export function factsSourceHash(p: Pick<FactsInput, "name" | "ingredients_raw" | "label_claims">): string {
  return crypto.createHash("sha1").update(JSON.stringify([FACTS_VERSION, p.name, p.ingredients_raw ?? "", p.label_claims])).digest("hex").slice(0, 16);
}

export function factsRow(p: FactsSourceRow, f: ProductFacts) {
  const pack = parsePack(p.net_weight);
  const ppu = pricePer100(p.price_inr == null ? null : Number(p.price_inr), pack);
  const by = (s: string) => CONCEPT_IDS.filter(c => f.concepts[c] === s);
  return {
    product_id: p.id, facts_version: FACTS_VERSION, ingredient_status: f.ingredient_status,
    present: by("present"), may_contain: by("may_contain"), unknown: by("unknown"),
    claims: f.claims, conflicts: f.conflicts, veg: f.veg, vegan: f.vegan, jain: f.jain,
    kind: f.kind || null, ingredients: f.ingredients, evidence: f.evidence,
    pack_qty: pack?.qty ?? null, pack_unit: pack?.unit ?? null,
    price_per_100: ppu == null ? null : Math.round(ppu * 100) / 100,
    source_hash: factsSourceHash(p), model: FACTS_MODEL, variant_key: variantKey(p.brand, p.name),
  };
}

export async function upsertFacts(sql: postgres.Sql, rows: ReturnType<typeof factsRow>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      insert into public.product_facts ${sql(chunk.map(r => ({ ...r, evidence: sql.json(r.evidence) })) as never)}
      on conflict (product_id) do update set
        facts_version = excluded.facts_version, ingredient_status = excluded.ingredient_status,
        present = excluded.present, may_contain = excluded.may_contain, unknown = excluded.unknown,
        claims = excluded.claims, conflicts = excluded.conflicts, veg = excluded.veg, vegan = excluded.vegan,
        jain = excluded.jain, kind = excluded.kind, ingredients = excluded.ingredients, evidence = excluded.evidence,
        pack_qty = excluded.pack_qty, pack_unit = excluded.pack_unit, price_per_100 = excluded.price_per_100,
        source_hash = excluded.source_hash, model = excluded.model, variant_key = excluded.variant_key,
        nutrition_suspect = null, nutrition_note = null, built_at = now()`;
  }
  // New rows need their compact embedding copy (the trigger only fires on index writes).
  await sql`
    update public.product_facts f set embedding_bits = binary_quantize(si.embedding)::bit(1024)
    from public.product_search_index si
    where si.product_id = f.product_id and si.embedding is not null and f.embedding_bits is null`;
}

/** Derived columns that only depend on catalog fields (cheap; safe to run for all rows). */
export async function refreshDerived(sql: postgres.Sql, sources: FactsSourceRow[]): Promise<number> {
  let changed = 0;
  const rows = sources.map(p => {
    const pack = parsePack(p.net_weight);
    const ppu = pricePer100(p.price_inr == null ? null : Number(p.price_inr), pack);
    return [p.id, variantKey(p.brand, p.name), pack?.qty ?? null, pack?.unit ?? null, ppu == null ? null : Math.round(ppu * 100) / 100];
  });
  for (let i = 0; i < rows.length; i += 1000) {
    const res = await sql`
      update public.product_facts f
      set variant_key = v.vk, pack_qty = v.qty::numeric, pack_unit = v.unit, price_per_100 = v.ppu::numeric
      from (values ${sql(rows.slice(i, i + 1000) as never)}) as v(id, vk, qty, unit, ppu)
      where f.product_id = v.id::uuid
        and (f.variant_key is distinct from v.vk or f.price_per_100 is distinct from v.ppu::numeric
             or f.pack_qty is distinct from v.qty::numeric)`;
    changed += res.count;
  }
  return changed;
}
