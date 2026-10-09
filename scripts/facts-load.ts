#!/usr/bin/env -S pnpm tsx
/**
 * Upsert extracted facts (JSONL) into public.product_facts. Rows whose source is
 * unchanged are skipped, so audit verdicts on them are preserved. Needs a
 * writable SUPABASE_DB_URL.
 *   pnpm facts:load -- --in .cache/facts/facts-v1.jsonl [--dry-run]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import fs from "node:fs";
import postgres from "postgres";
import type { ProductFacts } from "@/lib/facts/extract";
import { factsRow, factsSourceHash, loadFactsSources, upsertFacts } from "@/lib/facts/store";

const args = process.argv.slice(2);
const inPath = args.includes("--in") ? args[args.indexOf("--in") + 1]! : ".cache/facts/facts-v1.jsonl";
const dryRun = args.includes("--dry-run");

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url && !dryRun) throw new Error("SUPABASE_DB_URL (writable) is required");
  const sql = postgres(url ?? process.env.SCOUT_RO_DB_URL!, { max: 2, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} });

  const facts = new Map<string, ProductFacts>();
  for (const line of fs.readFileSync(inPath, "utf8").split("\n")) if (line.trim()) {
    const f = JSON.parse(line) as ProductFacts;
    facts.set(f.product_id, f);
  }
  const sources = await loadFactsSources(sql, [...facts.keys()]);
  const existing = new Map((await sql<{ product_id: string; source_hash: string }[]>`
    select product_id, source_hash from public.product_facts`).map(r => [r.product_id, r.source_hash]));
  const rows = sources
    .filter(p => existing.get(p.id) !== factsSourceHash(p))
    .map(p => factsRow(p, facts.get(p.id)!));
  console.log(`facts in file: ${facts.size}, matched products: ${sources.length}, changed: ${rows.length}`);
  if (dryRun) { if (rows[0]) console.log(JSON.stringify(rows[0], null, 1)); await sql.end(); return; }
  await upsertFacts(sql, rows);
  console.log(`upserted ${rows.length}`);
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
