#!/usr/bin/env -S pnpm tsx
/**
 * QA for the facts pass: cross-check model concepts against plain-text signals
 * in the raw label. These patterns are deliberately crude; they only surface
 * candidates for review and are never used at query time.
 *   pnpm facts:audit -- --in .cache/facts/facts-v1.jsonl [--show 5]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import fs from "node:fs";
import postgres from "postgres";
import type { ProductFacts } from "@/lib/facts/extract";
import type { ConceptId } from "@/lib/facts/vocab";

const args = process.argv.slice(2);
const inPath = args.includes("--in") ? args[args.indexOf("--in") + 1]! : ".cache/facts/facts-v1.jsonl";
const show = args.includes("--show") ? Number(args[args.indexOf("--show") + 1]) : 5;

// signal regex -> concept it should imply; "unless" removes known look-alikes.
const CHECKS: { concept: ConceptId; signal: RegExp; unless?: RegExp }[] = [
  { concept: "wheat", signal: /\bwheat\b|\bmaida\b|\bsemolina\b|\bsooji\b|\bsuji\b|\bdurum\b/i, unless: /buckwheat|wheat ?grass|free from wheat|wheat[- ]free|may contain|traces/i },
  { concept: "palm_oil", signal: /\bpalm/i, unless: /palm sugar|palm jaggery|date palm|palmyra|no palm|palm oil free|free from palm/i },
  { concept: "dairy", signal: /\bmilk\b|\bwhey\b|\bcasein|\bghee\b|\bbutter\b(?! ?milk)|\bcream\b|\bcheese\b|\bpaneer\b|\bkhoa\b/i, unless: /coconut milk|almond milk|oat milk|soy milk|cocoa butter|peanut butter|nut butter|shea|cream of|may contain|traces|dairy[- ]free|milk[- ]free/i },
  { concept: "added_sugar", signal: /\bsugar\b|\bjaggery\b|\bglucose\b|\bdextrose\b|\binvert\b|\bhoney\b|maltodextrin|syrup/i, unless: /no added sugar|sugar[- ]free|without sugar|sugar alcohol/i },
  { concept: "peanut", signal: /peanut|groundnut/i, unless: /may contain|traces|peanut[- ]free/i },
  { concept: "soy", signal: /\bsoy|\bsoya/i, unless: /may contain|traces|soy[- ]free/i },
  { concept: "artificial_sweetener", signal: /sucralose|aspartame|acesulfame|saccharin|neotame|\b95[0-5]\b/i },
  { concept: "egg", signal: /\begg\b|\beggs\b|albumen/i, unless: /eggless|egg[- ]free|may contain|traces|no egg/i },
  { concept: "meat", signal: /\bchicken\b|\bmutton\b|\bpork\b|\bbeef\b|\blamb\b/i, unless: /flavour|flavor|chicken style|vegan|veg /i },
];

async function main() {
  const url = process.env.SCOUT_RO_DB_URL?.trim() || process.env.SUPABASE_DB_URL?.trim();
  const sql = postgres(url!, { max: 2, prepare: false, ssl: { rejectUnauthorized: false } });
  const facts = new Map<string, ProductFacts>();
  for (const line of fs.readFileSync(inPath, "utf8").split("\n")) if (line.trim()) {
    const f = JSON.parse(line) as ProductFacts;
    facts.set(f.product_id, f);
  }
  const rows = await sql<{ id: string; name: string; ingredients_raw: string | null }[]>`
    select id, name, ingredients_raw from products where catalog_visible`;
  await sql.end();

  const missing = rows.filter(r => !facts.has(r.id));
  console.log(`visible: ${rows.length}, with facts: ${rows.length - missing.length}, missing: ${missing.map(m => m.name).join("; ")}`);
  for (const check of CHECKS) {
    const misses: string[] = [];
    let signals = 0;
    for (const r of rows) {
      const f = facts.get(r.id);
      const text = r.ingredients_raw ?? "";
      if (!f || f.ingredient_status !== "complete" || !check.signal.test(text) || (check.unless && check.unless.test(text))) continue;
      signals++;
      if (f.concepts[check.concept] !== "present") {
        const m = text.match(check.signal);
        const at = m?.index ?? 0;
        misses.push(`${r.name.slice(0, 50)} :: …${text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, " ")}… [${f.concepts[check.concept]}]`);
      }
    }
    console.log(`\n${check.concept}: ${misses.length}/${signals} signal hits not tagged present (${((misses.length / Math.max(1, signals)) * 100).toFixed(1)}%)`);
    for (const m of misses.slice(0, show)) console.log("   ", m);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
