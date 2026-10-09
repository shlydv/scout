import { config } from "dotenv"; config({ path: ".env.local", quiet: true });
import postgres from "postgres";
import { embedText } from "@/lib/search/v2/embeddings";
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });
await sql`select 1`;
let t = Date.now(); await sql`select 1`; console.log("rtt", Date.now() - t, "ms");
const e = await embedText("crispy potato chips without palm oil", "query");
const q = `explain (analyze, buffers, format text)
 select p.id, 1 - (si.embedding <=> $1::vector) sim,
   ts_rank_cd(si.search_tsv, plainto_tsquery('simple', $2)) lex
 from products p join product_search_index si on si.product_id = p.id
 left join product_facts f on f.product_id = p.id
 where p.catalog_visible and (p.subcategory || ' > ' || p.l3_category) = any($3::text[])
   and not coalesce(f.present && $4::text[], false)
 order by sim desc limit 96`;
t = Date.now();
const rows = await sql.unsafe(q, [`[${e.join(",")}]`, "crispy potato chips", ["Chips & Crisps > Chips", "Chips & Crisps > Crisps"], ["palm_oil"]] as never[]);
console.log("explain wall", Date.now() - t, "ms");
for (const r of rows) console.log(r["QUERY PLAN"]);
await sql.end();
