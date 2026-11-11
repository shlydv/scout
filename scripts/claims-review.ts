#!/usr/bin/env -S pnpm tsx
/**
 * The hand-check before a label conflict is published (docs/claims-review.md).
 *   pnpm claims:review pull <dir>                      # unreviewed conflicts → <dir>/candidates.json
 *   pnpm claims:review apply <dir>/candidates.json <verdicts.json>...
 * pull is read-only. apply only edits lib/insights/reviewed-claims.json; the site reads it from there.
 * Needs SUPABASE_DB_CA: the path to Supabase's root CA, so TLS to the database is verified.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { z } from "zod";
import type { ClaimReview } from "@/lib/insights/reviewed-claims";

const REVIEWS = "lib/insights/reviewed-claims.json";
const [command, ...rest] = process.argv.slice(2).filter(a => a !== "--");

type Candidate = {
  n: number; product_id: string; source_hash: string; brand: string | null; name: string; subcategory: string | null;
  claim: string; reality: string; kind: string; ocr_claims: string[] | null; retailer_free_from: string | null; ingredients_raw: string;
};
const verdicts = z.array(z.object({ n: z.number().int(), verdict: z.enum(["keep", "drop"]), reality: z.string().nullable(), reason: z.string() }));

const reviews = (): ClaimReview[] => JSON.parse(readFileSync(REVIEWS, "utf8"));
const keyOf = (r: { product_id: string; claim: string; source_hash: string }) => `${r.product_id}|${r.claim}|${r.source_hash}`;

async function pull(dir: string) {
  if (!process.env.SUPABASE_DB_CA) throw new Error("Set SUPABASE_DB_CA to the Supabase root CA file (docs/claims-review.md).");
  const sql = postgres(process.env.SUPABASE_DB_URL!, {
    max: 1, prepare: false, connect_timeout: 15, onnotice: () => {},
    ssl: { ca: readFileSync(process.env.SUPABASE_DB_CA, "utf8") },
    connection: { default_transaction_read_only: true },
  });
  try {
    const rows = await sql<Omit<Candidate, "n">[]>`
      select lc.product_id, lc.source_hash, p.brand, p.name, p.subcategory, lc.claim, lc.reality, lc.kind,
             si.claims ocr_claims, p.attributes->>'Label Free From' retailer_free_from, left(coalesce(p.ingredients_raw, ''), 1500) ingredients_raw
      from label_conflicts lc
      join products p on p.id = lc.product_id and p.catalog_visible
      left join product_search_index si on si.product_id = p.id
      where cardinality(p.image_urls) > 0
      order by lc.kind, p.brand, p.name, lc.claim`;
    const done = new Set(reviews().map(keyOf));
    const todo: Candidate[] = rows.filter(r => !done.has(keyOf(r))).map((r, i) => ({ n: i + 1, ...r }));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "candidates.json"), JSON.stringify(todo, null, 1));
    console.log(`${todo.length} of ${rows.length} conflicts need review → ${join(dir, "candidates.json")}`);
  } finally {
    await sql.end();
  }
}

function apply(candidatesFile: string, verdictFiles: string[]) {
  const candidates = new Map((JSON.parse(readFileSync(candidatesFile, "utf8")) as Candidate[]).map(c => [c.n, c]));
  const merged = new Map(reviews().map(r => [keyOf(r), r]));
  let keep = 0, drop = 0;
  for (const file of verdictFiles) {
    for (const v of verdicts.parse(JSON.parse(readFileSync(file, "utf8")))) {
      const c = candidates.get(v.n);
      if (!c) throw new Error(`${file}: no candidate ${v.n}`);
      if (v.verdict === "keep" && !v.reality?.trim()) throw new Error(`${file}: ${v.n} is kept without a reality line`);
      const review: ClaimReview = {
        product_id: c.product_id, claim: c.claim, source_hash: c.source_hash, verdict: v.verdict,
        reality: v.verdict === "keep" ? v.reality!.trim() : null, reason: v.reason, product: [c.brand, c.name].filter(Boolean).join(" · "),
      };
      merged.set(keyOf(review), review);
      if (v.verdict === "keep") keep++; else drop++;
    }
  }
  const out = [...merged.values()].sort((a, b) => a.product.localeCompare(b.product) || a.claim.localeCompare(b.claim));
  writeFileSync(REVIEWS, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`applied ${keep} kept, ${drop} dropped → ${REVIEWS} (${out.filter(r => r.verdict === "keep").length} published)`);
}

(async () => {
  if (command === "pull" && rest[0]) await pull(rest[0]);
  else if (command === "apply" && rest.length >= 2) apply(rest[0]!, rest.slice(1));
  else throw new Error("usage: pnpm claims:review pull <dir> | apply <candidates.json> <verdicts.json>...");
})().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
