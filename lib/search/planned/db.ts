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
  pool = postgres(url, {
    // Each serverless instance owns a pool; keep idle sessions from exhausting
    // the shared database limit across previews and concurrent page renders.
    max: 2, idle_timeout: 5, connect_timeout: 10, prepare: false,
    ssl: { rejectUnauthorized: false },
    connection: { statement_timeout: 8000 },
    onnotice: () => {},
  });
  return pool;
}

export async function closeSearchSql(): Promise<void> {
  if (pool) await pool.end({ timeout: 2 });
  pool = null;
}
