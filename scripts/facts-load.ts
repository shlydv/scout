#!/usr/bin/env -S pnpm tsx
/**
 * Upsert extracted facts (JSONL) into public.product_facts. Needs a writable
 * SUPABASE_DB_URL. Idempotent.
 *   pnpm facts:load -- --in .cache/facts/facts-v1.jsonl [--dry-run]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import crypto from "node:crypto";
import fs from "node:fs";
import postgres from "postgres";
import { FACTS_MODEL, FACTS_VERSION, type ProductFacts } from "@/lib/facts/extract";
import { parsePack, pricePer100 } from "@/lib/facts/pack";
import { CONCEPT_IDS } from "@/lib/facts/vocab";

const args = process.argv.slice(2);
const inPath = args[args.indexOf("--in") + 1] && args.includes("--in") ? args[args.indexOf("--in") + 1]! : ".cache/facts/facts-v1.jsonl";
const dryRun = args.includes("--dry-run");

export function factsSourceHash(p: { name: string; ingredients_raw: string | null; label_claims: string[] }): string {
  return crypto.createHash("sha1").update(JSON.stringify([FACTS_VERSION, p.name, p.ingredients_raw ?? "", p.label_claims])).digest("hex").slice(0, 16);
}

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url && !dryRun) throw new Error("SUPABASE_DB_URL (writable) is required");
  const sql = postgres(url ?? process.env.SCOUT_RO_DB_URL!, { max: 2, prepare: false, ssl: { rejectUnauthorized: false } });

  const facts = new Map<string, ProductFacts>();
  for (const line of fs.readFileSync(inPath, "utf8").split("\n")) if (line.trim()) {
    const f = JSON.parse(line) as ProductFacts;
    facts.set(f.product_id, f);
  }
  const products = await sql<{ id: string; name: string; ingredients_raw: string | null; price_inr: string | null; net_weight: string | null; label_claims: string[] }[]>`
    select p.id, p.name, p.ingredients_raw, p.price_inr, p.net_weight,
      array_remove(array_cat(coalesce(si.claims, '{}'), array[p.attributes->>'Label Free From', p.attributes->>'Label Certifications']), null) label_claims
    from products p left join product_search_index si on si.product_id = p.id
    where p.id = any(${[...facts.keys()]}::uuid[])`;

  const rows = products.map(p => {
    const f = facts.get(p.id)!;
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
      source_hash: factsSourceHash(p), model: FACTS_MODEL,
    };
  });
  console.log(`facts in file: ${facts.size}, matched products: ${rows.length}`);
  if (dryRun) { console.log(JSON.stringify(rows[0], null, 1)); await sql.end(); return; }

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
        source_hash = excluded.source_hash, model = excluded.model, built_at = now()`;
    console.log(`upserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
