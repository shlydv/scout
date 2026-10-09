#!/usr/bin/env -S pnpm tsx
/**
 * Evaluate planned search on eval/search-cases.json (pass/fail) and optionally
 * the search-hammer battery (report only).
 *   pnpm search:planned-eval                 # all cases
 *   pnpm search:planned-eval -- --only gluten,milk --concurrency 3
 *   pnpm search:planned-eval -- --hammer     # also dump hammer queries to .cache/eval/hammer.md
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import fs from "node:fs";
import { mapPool } from "@/lib/async-pool";
import { closeSearchSql } from "@/lib/search/planned/db";
import { plannedSearch, type PlannedSearchResult } from "@/lib/search/planned/search";

type EvalCase = {
  id: string;
  query: string;
  must_include_patterns: string[];
  must_exclude_patterns: string[];
  min_results?: number;
  expected_top1_patterns?: string[];
  adherence?: {
    scope?: number; max_price?: number; max_sugar_g?: number; min_protein_g?: number;
    no_added_sugar?: boolean; vegan?: boolean; gluten_free?: boolean; palm_oil_free?: boolean;
  };
};

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const only = opt("only")?.split(",");
const concurrency = Number(opt("concurrency") ?? 3);

const text = (it: PlannedSearchResult["items"][number]) =>
  `${it.name} ${it.brand ?? ""} ${it.l3 ?? ""} ${it.subcategory ?? ""} ${it.kind ?? ""}`.toLowerCase();

function matches(hay: string, pat: string): boolean {
  const p = pat.toLowerCase().trim();
  if (!p) return false;
  const stem = p.replace(/s$/, "");
  return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(hay);
}

function check(c: EvalCase, r: PlannedSearchResult): string[] {
  const fails: string[] = [];
  const top = r.items.slice(0, 10);
  const min = c.min_results ?? 1;
  if (r.items.length < min) fails.push(`only ${r.items.length} results (< ${min})`);
  for (const p of c.must_include_patterns) {
    if (top.length && !top.some(it => matches(text(it), p))) fails.push(`no top-10 item matches "${p}"`);
  }
  if (c.must_include_patterns.length) {
    const off = top.slice(0, 5).filter(it => !c.must_include_patterns.some(p => matches(text(it), p)));
    if (off.length) fails.push(`top-5 off-target: ${off.map(o => o.name.slice(0, 40)).join("; ")}`);
  }
  for (const it of top) for (const p of c.must_exclude_patterns) {
    if (matches(text(it), p)) fails.push(`excluded "${p}" in: ${it.name.slice(0, 50)}`);
  }
  if (c.expected_top1_patterns?.length && r.items[0] && !c.expected_top1_patterns.some(p => matches(text(r.items[0]!), p))) {
    fails.push(`top1 "${r.items[0].name.slice(0, 50)}" misses ${c.expected_top1_patterns.join("/")}`);
  }
  const a = c.adherence;
  if (a) for (const it of r.items.slice(0, a.scope ?? r.items.length)) {
    const n = it.nutrition ?? {};
    const sugar = n.sugar_g_100g == null ? null : Number(n.sugar_g_100g);
    const protein = n.protein_g_100g == null ? null : Number(n.protein_g_100g);
    if (a.max_price != null && it.price_inr != null && it.price_inr > a.max_price) fails.push(`${it.name}: ₹${it.price_inr} > ${a.max_price}`);
    if (a.max_sugar_g != null && sugar != null && sugar > a.max_sugar_g) fails.push(`${it.name}: sugar ${sugar} > ${a.max_sugar_g}`);
    if (a.min_protein_g != null && protein != null && protein < a.min_protein_g) fails.push(`${it.name}: protein ${protein} < ${a.min_protein_g}`);
    if (a.no_added_sugar && it.present.includes("added_sugar")) fails.push(`${it.name}: has added sugar`);
    if (a.vegan && it.vegan === false) fails.push(`${it.name}: not vegan`);
    if (a.gluten_free && it.present.includes("gluten_source")) fails.push(`${it.name}: gluten source`);
    if (a.palm_oil_free && it.present.includes("palm_oil")) fails.push(`${it.name}: palm oil`);
  }
  return fails;
}

function hammerQueries(): string[] {
  const src = fs.readFileSync("scripts/search-hammer.ts", "utf8");
  return [...new Set([...src.matchAll(/\bquery:\s*"([^"]+)"/g)].map(m => m[1]!))];
}

async function main() {
  fs.mkdirSync(".cache/eval", { recursive: true });
  let cases = JSON.parse(fs.readFileSync("eval/search-cases.json", "utf8")) as EvalCase[];
  if (only) cases = cases.filter(c => only.some(o => c.id.includes(o) || c.query.includes(o)));

  const results = await mapPool(cases, concurrency, async c => {
    try {
      const r = await plannedSearch(c.query, { limit: 24 });
      return { c, r, fails: check(c, r) };
    } catch (e) {
      return { c, r: null, fails: [`ERROR ${(e as Error).message}`] };
    }
  });

  const lat = results.flatMap(x => (x.r ? [x.r.timings.total_ms] : [])).sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  let tokensIn = 0, tokensOut = 0, calls = 0;
  for (const { c, r, fails } of results) {
    if (r) { tokensIn += r.llm.prompt_tokens; tokensOut += r.llm.completion_tokens; calls += r.llm.calls; }
    const head = `${fails.length ? "FAIL" : "pass"}  ${c.id.padEnd(32)} ${String(r?.items.length ?? "-").padStart(3)} items  ${r ? `${r.timings.total_ms}ms` : ""}`;
    console.log(head);
    for (const f of fails.slice(0, 4)) console.log(`        - ${f}`);
    if (fails.length && r) console.log(`        plan: ${JSON.stringify({ l3: r.plan.l3.slice(0, 6), sub: r.plan.subcategories, brands: r.plan.brands, ex: r.plan.exclude, req: r.plan.require, num: r.plan.numeric, sort: r.plan.sort, terms: r.plan.name_terms })}`);
  }
  const passed = results.filter(x => !x.fails.length).length;
  console.log(`\n${passed}/${results.length} passed · latency p50 ${pct(0.5)}ms p90 ${pct(0.9)}ms max ${lat.at(-1)}ms · ${calls} LLM calls, ${tokensIn} in / ${tokensOut} out tokens`);
  fs.writeFileSync(".cache/eval/planned-eval.json", JSON.stringify(results.map(x => ({ id: x.c.id, query: x.c.query, fails: x.fails, plan: x.r?.plan, timings: x.r?.timings, top: x.r?.items.slice(0, 10).map(i => i.name) })), null, 1));

  if (args.includes("--hammer")) {
    const qs = hammerQueries();
    const out: string[] = [`# Hammer battery (${qs.length} queries)\n`];
    const rs = await mapPool(qs, concurrency, async q => {
      try { return { q, r: await plannedSearch(q, { limit: 8 }) }; } catch (e) { return { q, err: (e as Error).message }; }
    });
    for (const x of rs) {
      if (!("r" in x) || !x.r) { out.push(`## ${x.q}\nERROR ${"err" in x ? x.err : ""}\n`); continue; }
      out.push(`## ${x.q}\n_${x.r.summary}_ · ${x.r.timings.total_ms}ms${x.r.relaxed.length ? ` · relaxed ${x.r.relaxed.join(", ")}` : ""}\n`);
      x.r.items.forEach((it, i) => out.push(`${i + 1}. ${it.name} — ₹${it.price_inr ?? "?"} · ${it.l3}${it.verdict ? ` · ${it.verdict}` : ""}${it.notes.length ? ` · ${it.notes.join("; ")}` : ""}`));
      if (!x.r.items.length && x.r.unconfirmed.length) out.push(`(unconfirmed: ${x.r.unconfirmed.slice(0, 3).map(u => u.name).join("; ")})`);
      out.push("");
    }
    fs.writeFileSync(".cache/eval/hammer.md", out.join("\n"));
    console.log(`hammer report: .cache/eval/hammer.md`);
  }
  await closeSearchSql();
}

main().catch(e => { console.error(e); process.exit(1); });
