#!/usr/bin/env -S pnpm tsx
/** Print search plans for queries:  pnpm tsx scripts/plan-try.ts "gluten free biscuits under 100" ... */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import { closeSearchSql, searchSql } from "@/lib/search/planned/db";
import { planQuery } from "@/lib/search/planned/plan";
import { loadVocabulary } from "@/lib/search/planned/vocabulary";

async function main() {
  const vocab = await loadVocabulary(searchSql());
  for (const q of process.argv.slice(2)) {
    const { plan, dropped, usage, ms } = await planQuery(q, vocab);
    const u = usage as Record<string, number> | null;
    const compact = Object.fromEntries(Object.entries(plan).filter(([, v]) =>
      !(Array.isArray(v) && !v.length) && v !== null && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)));
    console.log(`\n### ${q}  [${ms}ms, in=${u?.prompt_tokens} cached=${u?.prompt_cache_hit_tokens} out=${u?.completion_tokens}]`);
    console.log(JSON.stringify(compact));
    if (dropped.length) console.log("dropped:", dropped.join(", "));
  }
  await closeSearchSql();
}
main().catch(e => { console.error(e); process.exit(1); });
