# Deploy

Scout is a standard Next.js app on Vercel (project `oasis`, region `sin1`) reading a Supabase Postgres database. Pushing to `main` deploys production; every PR gets a preview.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production and Preview). `.env.example` lists the same keys.

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public URL, used in metadata and the sitemap |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only |
| `SUPABASE_DB_URL` | Postgres URL via the **transaction pooler (port 6543)** |
| `DEEPSEEK_API_KEY` | Search planner and verifier ([docs/planned-search.md](docs/planned-search.md)) |
| `VOYAGE_API_KEY` | Query embeddings; must match the index (voyage-3.5, 1024 dims) |
| `CRON_SECRET` / `ADMIN_SECRET` | Bearer auth for `/api/cron/*`, `/api/revalidate`, `/api/admin/*` |
| `ADMIN_EMAILS` | Google accounts allowed into `/admin` |
| `RESEND_API_KEY` + `NEXT_PUBLIC_SEARCH_ALERTS=1` | Optional: saved-search alert emails (button hidden otherwise) |
| `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` | Optional: error monitoring (inert when empty) |

Changing a `NEXT_PUBLIC_*` value needs a redeploy; data changes don't.

## Database

Apply migrations in order with `pnpm db:apply supabase/migrations/<file>.sql` (currently through `0048`). The free tier caps the database at 500 MB, and Scout uses about 440 MB, so check size before adding large columns or indexes.

## Cron

`vercel.json` runs `/api/cron/search-alerts` daily at 03:00 UTC.

## After a deploy

```bash
pnpm search:remote -- --url https://<deployment> "namkeen" "gluten free biscuits under 100"
```

`search:remote` uses `VERCEL_BYPASS_SECRET` for protected previews. Shelf and brand pages render on first visit and are then cached, so open `/shelves` once to warm them.

## Rollback

Vercel → Deployments → pick the last good deployment → **Promote to Production**. Migrations are additive, so older code keeps working against a newer schema.
