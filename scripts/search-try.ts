#!/usr/bin/env -S pnpm tsx
/**
 * Run the full planned-search path locally and print results.
 *   pnpm search:try "gluten free biscuits under 100" "healthier than maggi"
 *   options: --json  --limit 10  --verify / --no-verify
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import { closeSearchSql } from "@/lib/search/planned/db";
import { plannedSearch } from "@/lib/search/planned/search";

const args = process.argv.slice(2);
const json = args.includes("--json");
const li = args.indexOf("--limit");
const limit = li >= 0 ? Number(args[li + 1]) : 10;
const verify = args.includes("--verify") ? true : args.includes("--no-verify") ? false : undefined;
const queries = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");

async function main() {
  for (const q of queries) {
    const r = await plannedSearch(q, { limit, verify });
    if (json) { console.log(JSON.stringify(r)); continue; }
    const t = r.timings;
    console.log(`\n━━ ${q}`);
    console.log(`   ${r.summary}  [total ${t.total_ms}ms = plan ${t.plan_cached ? "cached" : t.plan_ms} · embed ${t.embed_ms} · sql ${t.execute_ms} · verify ${t.verify_ms}]`);
    console.log(`   counts: ${r.counts.map(c => `${c.step}=${c.confirmed}/${c.matched}`).join(" → ")}${r.relaxed.length ? `  relaxed: ${r.relaxed.join(", ")}` : ""}${r.reference ? `  ref ${r.reference.value} (${r.reference.products.slice(0, 2).join("; ")})` : ""}`);
    r.items.forEach((it, i) => {
      const n = it.nutrition ?? {};
      console.log(`   ${String(i + 1).padStart(2)}. ${it.name.slice(0, 60)} | ${it.brand ?? "-"} | ₹${it.price_inr ?? "?"} ${it.net_weight ?? ""} | ${it.l3} | score ${it.scout_score ?? "-"} | P${n.protein_g_100g ?? "?"} S${n.sugar_g_100g ?? "?"}${it.verdict ? ` | ${it.verdict}: ${it.why}` : ""}${it.notes.length ? ` | ${it.notes.join("; ")}` : ""}`);
    });
    if (r.unconfirmed.length) console.log(`   (+${r.unconfirmed.length} unconfirmed, e.g. ${r.unconfirmed.slice(0, 2).map(u => `${u.name.slice(0, 40)}: ${u.notes[0]}`).join(" / ")})`);
  }
  await closeSearchSql();
}
main().catch(e => { console.error(e); process.exit(1); });
