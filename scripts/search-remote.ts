#!/usr/bin/env -S pnpm tsx
/**
 * Query a deployed /api/search (preview or production) and print results.
 *   pnpm search:remote -- --url https://oasis-xyz.vercel.app "gluten free biscuits" "amul doodh"
 * Uses VERCEL_BYPASS_SECRET for protected preview deployments.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const base = args.includes("--url") ? args[args.indexOf("--url") + 1]!.replace(/\/+$/, "") : "";
const queries = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--url");
if (!base || !queries.length) throw new Error("usage: search:remote -- --url <deployment> <query...>");

async function main() {
  for (const q of queries) {
    const started = Date.now();
    const res = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.VERCEL_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS_SECRET } : {}),
      },
      body: JSON.stringify({ q, limit: 24 }),
    });
    const ms = Date.now() - started;
    const region = res.headers.get("x-vercel-id")?.split("::").slice(0, -1).join("→") ?? "?";
    const body = await res.json().catch(() => null) as { summary?: string; chips?: string[]; items?: { name: string; price_inr: number | null; warning?: string | null; reasons?: string[]; sizes?: unknown[] }[]; timings?: { total_ms: number; plan_cached: boolean }; error?: string } | null;
    console.log(`\n━━ ${q}  [${res.status} · ${ms}ms wall · server ${body?.timings?.total_ms ?? "?"}ms${body?.timings?.plan_cached ? " (plan cached)" : ""} · ${region}]`);
    if (!res.ok || !body?.items) { console.log("   ", body?.error ?? JSON.stringify(body)?.slice(0, 200)); continue; }
    console.log(`   ${body.summary}${body.chips?.length ? `  [${body.chips.join(" · ")}]` : ""}`);
    body.items.slice(0, 6).forEach((it, i) => console.log(`   ${i + 1}. ${it.name.slice(0, 60)} | ₹${it.price_inr ?? "?"}${it.sizes?.length ? ` | ${it.sizes.length} sizes` : ""}${it.reasons?.length ? ` | ${it.reasons.join(", ")}` : ""}${it.warning ? ` | ⚠ ${it.warning}` : ""}`));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
