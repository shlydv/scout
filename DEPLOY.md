# Deploy online (Vercel — free)

The app is a standard Next.js site. Your **database stays on Supabase** (already public-read via RLS). Vercel only hosts the frontend + server routes.

## 1. Push to GitHub (recommended)

```bash
cd ~/Desktop/oasis-clone
git init
git add .
git commit -m "Initial deploy: catalog UI + Core scores"
```

Create a repo on GitHub, then:

```bash
git remote add origin git@github.com:YOUR_USER/oasis-clone.git
git push -u origin main
```

## 2. Import on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → **Import** your GitHub repo.
2. Framework: **Next.js** (auto-detected).
3. Add **Environment variables** (Production + Preview):

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` (Settings → API in Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase → Settings → API → `service_role` |
| `NEXT_PUBLIC_SITE_URL` | Leave empty on first deploy; after deploy set to `https://YOUR-APP.vercel.app` and redeploy |

Required for search (see [planned search](docs/planned-search.md)):

| Variable | Value |
|----------|-------|
| `SUPABASE_DB_URL` | Postgres connection string — use the **transaction pooler (port 6543)** on Vercel |
| `DEEPSEEK_API_KEY` | Planner and verifier (deepseek-flash) |
| `VOYAGE_API_KEY` | Query embeddings; must match the index model (voyage-3.5, 1024 dims) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → public anon key |

Optional: `RESEND_API_KEY` + `NEXT_PUBLIC_SEARCH_ALERTS=1` turn on saved-search alert emails (the "Alert me" button is hidden without them).

Apply migrations through `0048` (`pnpm db:apply supabase/migrations/<file>.sql`). Functions run in `sin1` (vercel.json), next to the Supabase database.

**Do not** add `GEMINI_API_KEY` to Vercel unless you run OCR/scoring in CI — those scripts run locally, not on the hosted site.

4. Click **Deploy**.

## 3. One-command deploy (CLI, no GitHub)

```bash
pnpm add -g vercel   # or: npx vercel
cd ~/Desktop/oasis-clone
vercel login
vercel --prod
```

Paste the same env vars when prompted, or add them in the Vercel dashboard → Project → Settings → Environment Variables.

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` is **server-only** on Vercel (no `NEXT_PUBLIC_` prefix) — safe for App Router server components.
- `.env.local` is gitignored; never commit keys.
- Supabase RLS already allows **public read** on `products` and `core_scores`; writes stay blocked for anonymous users.

## Free access

Search is unlimited for guests and signed-in users. Accounts are used for saved searches and alerts; there are no paid features or billing endpoints. Old pricing links redirect to search.

When retiring a previous paid deployment, cancel any active recurring subscriptions in the Razorpay dashboard, disable the old webhook, and remove the billing environment variables. Removing application code does not cancel existing payment mandates. Historical database migrations and billing records are retained for reconciliation; the app no longer reads them.

## Admin, cron & cache purge

Set these in Vercel (Production) so admin tools and alerts are not open to the world:

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Vercel Cron + `/api/cron/search-alerts` Bearer auth; also accepts as `/api/revalidate?secret=` |
| `ADMIN_SECRET` | Optional dedicated secret for `/api/admin/*` and revalidate (falls back to `CRON_SECRET`) |
| `ADMIN_EMAILS` | Comma-separated Google emails allowed to use `/admin` UI |
| `UNLIMITED_EMAILS` | Legacy alias for the admin email allowlist |
| `RESEND_API_KEY` | Optional — emails saved-search alert hits; without it, alerts are in-app only |

Apply migration `0040_alert_notifications.sql` in Supabase for the in-app alert inbox.

## Error monitoring (Sentry) — recommended before launch

1. Create a free Sentry project (platform: Next.js).
2. Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same DSN) in Vercel and redeploy.
3. Without the DSNs the integration is fully inert — no overhead, no errors reported.

## After deploy

- Open `https://YOUR-APP.vercel.app/search`
- Set `NEXT_PUBLIC_SITE_URL` to that URL, then **Redeploy** once (Vercel → Deployments → Redeploy) so metadata picks up the env var.
- Smoke search: `pnpm search:remote -- --url <deployment> "namkeen" "gluten free biscuits under 100" "peanut allergy chocolate"` (uses `VERCEL_BYPASS_SECRET` for protected previews).
- Offline checks: `pnpm search:test` and `node --import tsx scripts/free-access-regression.ts`. Full eval (uses DeepSeek, a few cents): `pnpm search:eval [-- --hammer]`.
- After a catalog sync: `pnpm search:build-index -- --skip-unchanged` then `pnpm facts:sync -- --audits`.

## Does scraping / OCR update the live site?

**Yes for data, no redeploy needed.** The Vercel app reads from Supabase on each request. When you run locally:

- `pnpm scrape:packaged` → new rows in `products`
- `pnpm scrape:packaged:detail` → ingredients, nutrition, scores
- `pnpm scrape:expand` → up to 4000 SKUs across snacks, breakfast, sweet tooth, bakery, sauces, organic, dairy (full pagination)
- `pnpm scrape:expand:detail` → PDP pass for rows missing `raw_payload`
- `pnpm score` → `core_scores` updated

Refresh retrieval with `pnpm search:build-index -- --skip-unchanged` after catalog updates. Search-result caches expire after five minutes; candidate evidence is read from current product records.

**Redeploy only when** you change code or `NEXT_PUBLIC_*` env vars. Pushing to GitHub (`oasis.git`) auto-deploys if the repo is linked to Vercel.

## Custom domain (optional)

Vercel → Project → **Domains** → add `yourdomain.com` and follow DNS instructions.
