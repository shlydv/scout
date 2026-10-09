#!/usr/bin/env -S pnpm tsx
/** Apply one SQL migration file with SUPABASE_DB_URL:  pnpm db:apply supabase/migrations/0045_x.sql */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
import fs from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) throw new Error("usage: db:apply <file.sql>");
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} });
const started = Date.now();
await sql.unsafe(fs.readFileSync(file, "utf8"));
console.log(`applied ${file} in ${Date.now() - started}ms`);
await sql.end();
