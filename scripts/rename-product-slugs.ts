#!/usr/bin/env -S pnpm tsx
/**
 * Drop the leading platform name from product slugs:
 *   "<platform>-<brand>-<name>-<sku>"  →  "<brand>-<name>-<sku>"
 * Old URLs keep working: the products trigger from migration 0051 records every old
 * slug in product_slug_redirects, and the app answers old URLs with a 308.
 *
 *   pnpm catalog:rename-slugs                     read-only: checks + backup of old → new pairs
 *   pnpm catalog:rename-slugs -- --apply          checks, backup, then rename in batches
 *   pnpm catalog:rename-slugs -- --restore=FILE   put the slugs from a backup file back
 *
 * Options: --batch=1000  --max-db-mb=490  --backup-dir=.cache/slug-rename
 *          --limit=N   rename only the first N products (a canary to check redirects first)
 * Each batch is its own transaction followed by VACUUM, so dead row versions are
 * reused instead of growing the database toward the 500 MB free-tier cap. The run
 * stops if the database grows past --max-db-mb. Re-running after a stop is safe.
 *
 * Needs SUPABASE_DB_URL (.env.local). TLS is verified; point SUPABASE_DB_CA at the
 * project's CA certificate (Supabase → Database → SSL) if the system store lacks it.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";

type Sql = postgres.Sql;
type Pair = { id: string; old_slug: string; new_slug: string };

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

const APPLY = arg("apply") === "true";
const RESTORE = arg("restore");
const BATCH = Number(arg("batch") ?? 1000);
const MAX_DB_MB = Number(arg("max-db-mb") ?? 490);
const BACKUP_DIR = resolve(arg("backup-dir") ?? ".cache/slug-rename");
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;

function connect(): Sql {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Set SUPABASE_DB_URL in .env.local");
  const ca = process.env.SUPABASE_DB_CA;
  return postgres(url, {
    max: 1,
    prepare: false,
    ssl: ca ? { ca: readFileSync(ca, "utf8") } : "verify-full",
    connect_timeout: 15,
    onnotice: () => {},
  });
}

async function hasRedirects(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ ready: boolean }[]>`
    select to_regclass('public.product_slug_redirects') is not null
      and to_regprocedure('public.current_product_slugs(text[])') is not null
      and exists (select 1 from pg_trigger where tgname = 'products_slug_redirect' and not tgisinternal) as ready`;
  return row.ready;
}

/** Products whose slug still starts with "<platform>-", with the slug minus that prefix.
 *  A product whose current slug was itself made by stripping "<platform>-" (its brand is
 *  the platform name) is skipped, so a re-run never strips twice. */
function candidates(sql: Sql, redirectsReady: boolean) {
  return sql`
    select p.id, p.platform, p.slug as old_slug, ltrim(substr(p.slug, length(p.platform) + 2), '-') as new_slug
    from products p
    where coalesce(p.platform, '') <> ''
      and left(p.slug, length(p.platform) + 1) = p.platform || '-'
      ${redirectsReady ? sql`and not exists (select 1 from product_slug_redirects r where r.old_slug = p.platform || '-' || p.slug)` : sql``}`;
}

async function dbSizeMb(sql: Sql): Promise<number> {
  const [row] = await sql<{ bytes: string }[]>`select pg_database_size(current_database())::text as bytes`;
  return Number(row.bytes) / 1024 / 1024;
}

async function report(sql: Sql, redirectsReady: boolean): Promise<boolean> {
  const [c] = await sql<Record<string, number>[]>`
    with c as (${candidates(sql, redirectsReady)})
    select (select count(*) from products)::int as products,
           (select count(*) from c)::int as to_rename,
           (select count(*) from c where new_slug = '')::int as empty,
           (select count(*) from (select new_slug from c group by 1 having count(*) > 1) d)::int as duplicate_new,
           (select count(*) from c join products p on p.slug = c.new_slug)::int as already_taken,
           (select count(*) from c where new_slug !~ '^[a-z0-9][a-z0-9-]*$')::int as unusual_chars,
           (select count(*) from c where left(new_slug, length(platform) + 1) = platform || '-')::int as still_prefixed`;
  console.log("[rename-slugs] checks", c);

  const sizes = await sql`
    select c.relname as table,
           pg_size_pretty(pg_relation_size(c.oid)) as heap,
           pg_size_pretty(pg_indexes_size(c.oid)) as indexes,
           pg_size_pretty(pg_total_relation_size(c.oid)) as total,
           s.n_tup_upd as updates, s.n_tup_hot_upd as hot_updates, s.n_dead_tup as dead_rows
    from pg_class c join pg_stat_user_tables s on s.relid = c.oid
    where c.oid in (to_regclass('public.products'), to_regclass('public.product_search_index'), to_regclass('public.saved_products'))`;
  console.table(sizes);
  console.log(`[rename-slugs] database ${(await dbSizeMb(sql)).toFixed(1)} MB (stop at ${MAX_DB_MB} MB)`);
  if (await sql`select to_regclass('public.saved_products') is not null as t`.then((r) => r[0].t)) {
    const [s] = await sql<{ n: number }[]>`select count(*)::int as n from saved_products`;
    console.log(`[rename-slugs] saved_products rows: ${s.n}`);
  }

  const samples = await sql`with c as (${candidates(sql, redirectsReady)}) select old_slug, new_slug from c order by random() limit 5`;
  console.table(samples);
  if (c.still_prefixed) {
    const rows = await sql`with c as (${candidates(sql, redirectsReady)}) select old_slug, new_slug from c where left(new_slug, length(platform) + 1) = platform || '-' limit 10`;
    console.log("[rename-slugs] new slugs that still start with the platform name (brand is the platform):");
    console.table(rows);
  }
  return c.empty === 0 && c.duplicate_new === 0 && c.already_taken === 0;
}

function writeBackup(pairs: Pair[]): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `slug-pairs-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const body = pairs.map((p) => JSON.stringify(p)).join("\n") + "\n";
  writeFileSync(file, body);
  const sha = createHash("sha256").update(body).digest("hex");
  console.log(`[rename-slugs] backup: ${file} (${pairs.length} pairs, sha256 ${sha.slice(0, 16)}…)`);
  return file;
}

function readBackup(file: string): Pair[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Pair);
}

/** Set slug `to` on every product still at slug `from`, in batches with VACUUM between. */
async function moveSlugs(sql: Sql, moves: { id: string; from: string; to: string }[]): Promise<number> {
  let moved = 0;
  for (let i = 0; i < moves.length; i += BATCH) {
    const chunk = moves.slice(i, i + BATCH);
    const started = Date.now();
    const rows = await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '300s'`;
      return tx`
        update products p set slug = v.to_slug
        from (values ${tx(chunk.map((m) => [m.id, m.from, m.to]))}) as v (id, from_slug, to_slug)
        where p.id = v.id::uuid and p.slug = v.from_slug
        returning p.id`;
    });
    moved += rows.length;
    await sql.unsafe("vacuum (analyze) products");
    const mb = await dbSizeMb(sql);
    console.log(
      `[rename-slugs] ${Math.min(i + BATCH, moves.length)}/${moves.length}: moved ${rows.length} in ${((Date.now() - started) / 1000).toFixed(1)}s, database ${mb.toFixed(1)} MB`,
    );
    if (mb > MAX_DB_MB) {
      console.error(`[rename-slugs] stopping: database is over ${MAX_DB_MB} MB. Re-run to continue once there is room.`);
      break;
    }
  }
  return moved;
}

async function verify(sql: Sql, pairs: Pair[]): Promise<void> {
  const [left] = await sql<{ n: number }[]>`with c as (${candidates(sql, true)}) select count(*)::int as n from c`;
  const [redirects] = await sql<{ n: number }[]>`select count(*)::int as n from product_slug_redirects`;
  console.log(`[rename-slugs] still to rename: ${left.n}; redirects on file: ${redirects.n}`);
  const sample = pairs.slice(0, 3).concat(pairs.slice(-2));
  const resolved = await sql<{ old_slug: string; slug: string }[]>`
    select * from current_product_slugs(${sample.map((p) => p.old_slug)}::text[])`;
  const bySlug = new Map(resolved.map((r) => [r.old_slug, r.slug]));
  for (const p of sample) {
    const got = bySlug.get(p.old_slug);
    console.log(`[rename-slugs] ${got === p.new_slug ? "ok  " : "FAIL"} ${p.old_slug} → ${got ?? "(none)"}`);
  }
}

async function main() {
  const sql = connect();
  try {
    const redirectsReady = await hasRedirects(sql);
    if (!redirectsReady) console.log("[rename-slugs] migration 0051 is not applied yet (needed for --apply / --restore)");

    if (RESTORE) {
      if (!redirectsReady) throw new Error("apply migration 0051 before restoring");
      const pairs = readBackup(resolve(RESTORE));
      const moved = await moveSlugs(sql, pairs.map((p) => ({ id: p.id, from: p.new_slug, to: p.old_slug })));
      console.log(`[rename-slugs] restored ${moved} of ${pairs.length} slugs from ${RESTORE}`);
      return;
    }

    const ok = await report(sql, redirectsReady);
    const pairs = await sql<Pair[]>`with c as (${candidates(sql, redirectsReady)}) select id, old_slug, new_slug from c order by id`;
    if (!pairs.length) {
      console.log("[rename-slugs] nothing to rename");
      return;
    }
    writeBackup(pairs);
    if (!APPLY) {
      console.log(`[rename-slugs] dry run${ok ? "" : " — checks FAILED, --apply would refuse"}. Re-run with --apply to rename.`);
      return;
    }
    if (!ok || !redirectsReady) {
      console.error("[rename-slugs] refusing to apply: fix the failed checks / apply migration 0051 first");
      process.exitCode = 1;
      return;
    }
    if ((await dbSizeMb(sql)) > MAX_DB_MB) {
      console.error(`[rename-slugs] refusing to apply: database is already over ${MAX_DB_MB} MB`);
      process.exitCode = 1;
      return;
    }
    const batch = pairs.slice(0, LIMIT);
    const moved = await moveSlugs(sql, batch.map((p) => ({ id: p.id, from: p.old_slug, to: p.new_slug })));
    console.log(`[rename-slugs] renamed ${moved} of ${pairs.length}`);
    await verify(sql, batch);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
