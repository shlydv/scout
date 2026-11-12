/**
 * Postgres access for planned search. Reuses the shared search pool in the app;
 * scripts may point at a read-only role via SCOUT_RO_DB_URL.
 */
import postgres from "postgres";

export type Sql = postgres.Sql;

let pool: Sql | null = null;

export function searchSql(): Sql {
  if (pool) return pool;
  const url = process.env.SUPABASE_DB_URL?.trim() || process.env.SCOUT_RO_DB_URL?.trim();
  if (!url) throw new Error("SUPABASE_DB_URL is not configured");
  const options = {
    // Each serverless instance owns a pool; keep idle sessions from exhausting
    // the shared database limit across previews and concurrent page renders.
    max: 2, idle_timeout: 5, connect_timeout: 10, prepare: false,
    // One query in flight per connection. postgres.js pipelines up to 100 by default, and
    // Supabase's transaction pooler (port 6543, what Vercel uses) sometimes never answers a
    // pipelined query: the search then waits forever. Reproduced in single-worker builds:
    // 2 of 3 hung with pipelining, 0 of 3 without, and builds ran 2-3x faster.
    // (A real postgres.js option that its types leave out.)
    max_pipeline: 0,
    ssl: { rejectUnauthorized: false },
    connection: { statement_timeout: 8000 },
    onnotice: () => {},
  } satisfies postgres.Options<Record<string, postgres.PostgresType>> & { max_pipeline: number };
  pool = postgres(url, options);
  return pool;
}

export async function closeSearchSql(): Promise<void> {
  if (pool) await pool.end({ timeout: 2 });
  pool = null;
}
