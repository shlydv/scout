/**
 * Checks that public pages are served from Vercel's cache rather than rendered per visit.
 *
 * Every page a crawler can reach must be cached: a page that renders per request costs Fluid Active
 * CPU and a database read on every bot visit, and with ~15k product pages that is what used up the
 * free tiers twice (Nov 2026). Next.js turns a page per-request without warning when it reads
 * searchParams, cookies or headers, so check the live headers after each deploy.
 *
 * Usage: npm run cache:check [-- https://<deployment>]   (defaults to NEXT_PUBLIC_SITE_URL)
 * Exit code 1 if any page is rendered per request.
 */
const base = (process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("usage: npm run cache:check -- https://<site>");
  process.exit(2);
}

async function firstFromSitemap(pattern: RegExp): Promise<string | null> {
  const xml = await fetch(`${base}/sitemap.xml`).then((r) => r.text());
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const path = new URL(m[1]).pathname;
    if (pattern.test(path)) return path;
  }
  return null;
}

type Row = { path: string; status: number; cache: string; control: string; ok: boolean };

async function check(path: string): Promise<Row> {
  const get = () => fetch(`${base}${path}`, { redirect: "manual" });
  await get(); // the first request may legitimately fill the cache
  await new Promise((r) => setTimeout(r, 1000));
  const res = await get();
  await res.arrayBuffer();
  const cache = res.headers.get("x-vercel-cache") ?? "-";
  const control = res.headers.get("cache-control") ?? "-";
  const perRequest = /private|no-store/.test(control) || cache === "MISS" || cache === "BYPASS";
  return { path, status: res.status, cache, control, ok: res.status < 500 && !perRequest };
}

async function main() {
  const product = await firstFromSitemap(/^\/product\/[^/]+$/);
  const brand = await firstFromSitemap(/^\/brands\/[^/]+$/);
  const paths = [
    "/", "/catalog", "/brands", "/insights", "/insights/claims", "/insights/claims?kind=sugar", "/compare",
    "/sitemap.xml", "/robots.txt",
    ...(brand ? [brand] : []),
    ...(product ? [product, `${product}/opengraph-image`] : []),
  ];
  const rows: Row[] = [];
  for (const path of paths) rows.push(await check(path));
  console.table(rows.map(({ ok, ...r }) => ({ ...r, verdict: ok ? "cached" : "PER REQUEST" })));
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    console.error(`${bad.length} page(s) are rendered per request: ${bad.map((r) => r.path).join(", ")}`);
    process.exit(1);
  }
  console.log("All checked pages are served from the cache.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
