import { config } from "dotenv"; config({ path: ".env.local", quiet: true });
import postgres from "postgres";
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} });
const [before] = await sql`select count(*)::int total, count(*) filter (where p.catalog_visible is not true)::int hidden from product_search_index si join products p on p.id = si.product_id`;
console.log("before", before);
const deleted = await sql.begin(async tx => {
  const r = await tx`delete from product_search_index si using products p where p.id = si.product_id and p.catalog_visible is not true`;
  const [{ left }] = await tx`select count(*)::int as left from product_search_index si join products p on p.id = si.product_id where p.catalog_visible`;
  if (left !== before.total - before.hidden) throw new Error(`visible rows changed: ${left}`);
  return r.count;
});
console.log("deleted", deleted);
await sql.unsafe("vacuum analyze public.product_search_index");
const [after] = await sql`select count(*)::int rows, pg_size_pretty(pg_database_size(current_database())) db from product_search_index`;
console.log("after", after);
await sql.end();
