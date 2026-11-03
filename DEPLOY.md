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
| `PRODUCT_SLUG_REDIRECT_PREFIXES` | Optional: prefixes old product slugs start with (comma-separated). When set, only those slugs pay for the redirect lookup; empty checks every product URL. See [Product slugs](#product-slugs) |

Changing a `NEXT_PUBLIC_*` value needs a redeploy; data changes don't.

## Database

Apply migrations in order with `pnpm db:apply supabase/migrations/<file>.sql` (currently through `0051`). The free tier caps the database at 500 MB, and Scout uses about 440 MB, so check size before adding large columns or indexes.

### Product slugs

Product URLs are `/product/<slug>`. A slug can change: the `products_slug_redirect` trigger (migration `0051`) records every old slug in `product_slug_redirects`, and old URLs answer with a 308 to the current slug, query string included. That check runs in `proxy.ts`, before rendering: a redirect thrown inside the streamed page reaches browsers and crawlers as a 200 with a meta refresh, and a layout can't see `?context=` / `?q=`. Baskets and compare trays saved in a browser move to the new slugs the next time the basket or compare page loads. The lookup costs one small RPC per product request; set `PRODUCT_SLUG_REDIRECT_PREFIXES` to the prefix the old slugs share (for the rename below, the platform name plus `-`) so current slugs skip it, and clear or extend it if a later rename produces old slugs of another shape.

`pnpm catalog:rename-slugs` drops a leading platform name from slugs (`<platform>-<brand>-<name>-<sku>` → `<brand>-<name>-<sku>`):

1. Apply `0051` first, then deploy the app code that reads redirects.
2. Run `pnpm catalog:rename-slugs -- --backup-dir=<dir>` with no flags for read-only checks (collisions, sizes) and a backup of the old → new pairs.
3. Run it again with `--apply --limit=1` and open the old URL on production to see the 308, then run `--apply` for the rest. Each 1,000-row batch is followed by VACUUM, and the run stops above 490 MB.
4. Undo with `--restore=<backup file>`.

The script verifies TLS. If the pooler's certificate chain is not in the system store, download the CA from Supabase → Database → SSL and set `SUPABASE_DB_CA` to its path.

## Cron

`vercel.json` runs `/api/cron/search-alerts` daily at 03:00 UTC.

## After a deploy

```bash
pnpm search:remote -- --url https://<deployment> "namkeen" "gluten free biscuits under 100"
```

`search:remote` uses `VERCEL_BYPASS_SECRET` for protected previews. Shelf and brand pages render on first visit and are then cached, so open `/shelves` once to warm them.

## Rollback

Vercel → Deployments → pick the last good deployment → **Promote to Production**. Migrations are additive, so older code keeps working against a newer schema.
