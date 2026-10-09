#!/usr/bin/env -S pnpm tsx
/**
 * Offline product-facts pass (see lib/facts). Writes JSONL; resumable.
 *
 *   pnpm facts:extract -- --pilot                 # ~60 hard + random products
 *   pnpm facts:extract -- --limit 500             # next 500 not yet extracted
 *   pnpm facts:extract -- --all                   # every visible product
 *   options: --out .cache/facts/facts.jsonl --batch 8 --concurrency 4
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { mapPool } from "@/lib/async-pool";
import { extractFactsBatch, type FactsInput } from "@/lib/facts/extract";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const OUT = opt("out", ".cache/facts/facts.jsonl");
const BATCH = Number(opt("batch", "8"));
const CONCURRENCY = Number(opt("concurrency", "4"));

const dbUrl = process.env.SUPABASE_DB_URL?.trim() || process.env.SCOUT_RO_DB_URL?.trim();
if (!dbUrl) throw new Error("SUPABASE_DB_URL or SCOUT_RO_DB_URL is required");
const sql = postgres(dbUrl, { max: 2, prepare: false, ssl: { rejectUnauthorized: false } });

const SELECT = sql`
  select p.id, p.name, p.brand,
         concat_ws(' > ', p.category, p.subcategory, p.l3_category) category_path,
         p.ingredients_raw,
         array_remove(array_cat(coalesce(si.claims, '{}'),
           array[p.attributes->>'Label Free From', p.attributes->>'Label Certifications']), null) label_claims
  from products p left join product_search_index si on si.product_id = p.id
  where p.catalog_visible`;

async function loadInputs(done: Set<string>): Promise<FactsInput[]> {
  let rows: FactsInput[];
  if (flag("pilot")) {
    // Hard cases first: claim/ingredient conflicts, look-alike grains, unnamed oils,
    // cross-contact statements, incomplete lists; then a random slice.
    rows = await sql<FactsInput[]>`
      with base as (${SELECT}), hard as (
        (select * from base where ingredients_raw ~* 'buckwheat|ragi|jowar|kuttu|bajra|rice rava|samak' limit 8)
        union all (select * from base where label_claims::text ~* 'gluten' and ingredients_raw ~* 'wheat|maida|atta|rava|sooji|barley|malt' limit 8)
        union all (select * from base where ingredients_raw ~* 'vegetable (oil|fat)' and ingredients_raw !~* 'palm|sunflower|rice bran|soy|groundnut|mustard|olive|coconut' limit 5)
        union all (select * from base where ingredients_raw ~* 'may contain|traces|facility' limit 6)
        union all (select * from base where ingredients_raw ~* 'mrp|lot no|best before|use by' limit 4)
        union all (select * from base where name ~* 'milk chocolate' limit 3)
        union all (select * from base where ingredients_raw ~* 'sucralose|maltitol|stevia|ins ?95' limit 4)
        union all (select * from base where name ~* 'jain|soy sauce|teriyaki|noodles' limit 4)
      )
      select * from hard union (select * from base order by md5(id::text) limit 20)`;
  } else {
    rows = await sql<FactsInput[]>`select * from (${SELECT}) b order by id`;
  }
  const todo = rows.filter(r => !done.has(r.id));
  const limit = flag("all") || flag("pilot") ? todo.length : Number(opt("limit", "0"));
  return todo.slice(0, limit);
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const done = new Set<string>();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
      if (line.trim()) done.add((JSON.parse(line) as { product_id: string }).product_id);
    }
  }
  const inputs = await loadInputs(done);
  console.log(`to extract: ${inputs.length} (already done: ${done.size})`);
  const batches: FactsInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH) batches.push(inputs.slice(i, i + BATCH));

  const totals = { prompt: 0, cached: 0, completion: 0, ok: 0, failed: 0 };
  const started = Date.now();
  const out = fs.createWriteStream(OUT, { flags: "a" });
  await mapPool(batches, CONCURRENCY, async (batch, bi) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { facts, failed, usage } = await extractFactsBatch(batch);
        for (const f of facts) out.write(JSON.stringify(f) + "\n");
        const u = usage as Record<string, number> | null;
        totals.prompt += u?.prompt_tokens ?? 0;
        totals.cached += u?.prompt_cache_hit_tokens ?? 0;
        totals.completion += u?.completion_tokens ?? 0;
        totals.ok += facts.length;
        if (failed.length && attempt === 2) totals.failed += failed.length;
        if (!failed.length || attempt === 2) break;
        batch = batch.filter(p => failed.includes(p.id));
      } catch (e) {
        if (attempt === 2) { totals.failed += batch.length; console.error(`batch ${bi} failed:`, (e as Error).message); }
      }
    }
    if ((bi + 1) % 10 === 0) console.log(`${bi + 1}/${batches.length} batches, ${totals.ok} ok, ${totals.failed} failed, ${Math.round((Date.now() - started) / 1000)}s`);
  });
  out.end();
  await sql.end();
  console.log(JSON.stringify({ ...totals, seconds: Math.round((Date.now() - started) / 1000) }));
}

main().catch(e => { console.error(e); process.exit(1); });
