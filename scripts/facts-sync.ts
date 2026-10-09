#!/usr/bin/env -S pnpm tsx
/**
 * Incremental facts pipeline — run after every catalog sync:
 *   1. extract facts for visible products that are new or whose label/claims changed
 *   2. upsert them (embedding bits backfilled)
 *   3. refresh derived columns for everything (variant key, pack size, price per 100)
 *   4. with --audits: nutrition + completeness audits on changed products, then verify label conflicts
 *
 *   pnpm facts:sync                 # extract + load changed products
 *   pnpm facts:sync -- --audits     # also audit them
 *   pnpm facts:sync -- --dry-run    # report what would change
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { mapPool } from "@/lib/async-pool";
import { extractFactsBatch, type ProductFacts } from "@/lib/facts/extract";
import { factsRow, factsSourceHash, loadFactsSources, refreshDerived, upsertFacts, type FactsSourceRow } from "@/lib/facts/store";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const audits = args.includes("--audits");

async function main() {
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 3, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} });
  const sources = await loadFactsSources(sql);
  const existing = new Map((await sql<{ product_id: string; source_hash: string }[]>`
    select product_id, source_hash from public.product_facts`).map(r => [r.product_id, r.source_hash]));
  const changed = sources.filter(p => existing.get(p.id) !== factsSourceHash(p));
  console.log(`visible: ${sources.length}, new or changed: ${changed.length}`);

  if (!dryRun && changed.length) {
    const batches: FactsSourceRow[][] = [];
    for (let i = 0; i < changed.length; i += 8) batches.push(changed.slice(i, i + 8));
    const extracted: { p: FactsSourceRow; f: ProductFacts }[] = [];
    const byId = new Map(changed.map(p => [p.id, p]));
    await mapPool(batches, 6, async batch => {
      let pending = batch;
      // Malformed JSON loses a batch now and then; retry the remainder in pairs.
      for (const size of [pending.length, 2, 1]) {
        if (!pending.length) break;
        const groups: FactsSourceRow[][] = [];
        for (let i = 0; i < pending.length; i += size) groups.push(pending.slice(i, i + size));
        const failed: FactsSourceRow[] = [];
        for (const g of groups) {
          try {
            const { facts, failed: ids } = await extractFactsBatch(g);
            for (const f of facts) extracted.push({ p: byId.get(f.product_id)!, f });
            failed.push(...g.filter(p => ids.includes(p.id)));
          } catch {
            failed.push(...g);
          }
        }
        pending = failed;
      }
      if (pending.length) console.error(`could not extract: ${pending.map(p => p.name).join("; ")}`);
    });
    await upsertFacts(sql, extracted.map(({ p, f }) => factsRow(p, f)));
    console.log(`upserted ${extracted.length}`);
  }

  if (!dryRun) console.log(`derived columns refreshed: ${await refreshDerived(sql, sources)}`);
  await sql.end();

  if (audits && !dryRun && changed.length) {
    const ids = changed.map(p => p.id).join(",");
    for (const script of ["scripts/facts-nutrition-audit.ts", "scripts/facts-completeness-audit.ts", "scripts/facts-conflicts.ts"]) {
      execFileSync(process.execPath, ["--import", "tsx", script, "--ids", ids], { stdio: "inherit" });
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
