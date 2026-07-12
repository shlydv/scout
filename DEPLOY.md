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

Optional (AI search — use separate keys so label batch jobs do not starve live search):

| `DEEPSEEK_SEARCH_API_KEY` | Live search parse + rank (`/api/search/ai`) |
| `DEEPSEEK_LABEL_API_KEY` | Batch label extraction (`pnpm label:deepseek`) |
| `DEEPSEEK_API_KEY` | Fallback if the keys above are unset |

Optional (only if you add client-side Supabase later):

| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → `anon` `public` |

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

## Billing (Razorpay) — required once Scout Plus is on

1. Set all five env vars in Vercel: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID`, `RAZORPAY_PLAN_ID_YEARLY`, `RAZORPAY_WEBHOOK_SECRET`.
2. In the Razorpay dashboard → Webhooks, add `https://YOUR-APP.vercel.app/api/billing/webhook` with the same secret, subscribed to the `subscription.*` events.
3. **Webhooks fail closed**: if `RAZORPAY_WEBHOOK_SECRET` is missing or mismatched, every webhook is rejected and paying users are never upgraded to Plus — verify with a test payment end-to-end.

## Admin, cron & cache purge

Set these in Vercel (Production) so admin tools and alerts are not open to the world:

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Vercel Cron + `/api/cron/search-alerts` Bearer auth; also accepts as `/api/revalidate?secret=` |
| `ADMIN_SECRET` | Optional dedicated secret for `/api/admin/*` and revalidate (falls back to `CRON_SECRET`) |
| `ADMIN_EMAILS` | Comma-separated Google emails allowed to use `/admin` UI |
| `UNLIMITED_EMAILS` | Same emails also get unlimited AI (team bypass) |
| `RESEND_API_KEY` | Optional — emails saved-search alert hits; without it, alerts are in-app only |

Apply migration `0040_alert_notifications.sql` in Supabase for the in-app alert inbox.

## Error monitoring (Sentry) — recommended before launch

1. Create a free Sentry project (platform: Next.js).
2. Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same DSN) in Vercel and redeploy.
3. Without the DSNs the integration is fully inert — no overhead, no errors reported.

## After deploy

- Open `https://YOUR-APP.vercel.app/search`
- Set `NEXT_PUBLIC_SITE_URL` to that URL, then **Redeploy** once (Vercel → Deployments → Redeploy) so metadata picks up the env var.
- Smoke search: `namkeen` (instant catalog), `high protein milk`, `paneer under ₹150`
- Local regression: `pnpm search:regression` and `pnpm search:regression:live` (needs `.env.local`)

## Does scraping / OCR update the live site?

**Yes for data, no redeploy needed.** The Vercel app reads from Supabase on each request. When you run locally:

- `pnpm scrape:packaged` → new rows in `products`
- `pnpm scrape:packaged:detail` → ingredients, nutrition, scores
- `pnpm scrape:expand` → up to 4000 SKUs across snacks, breakfast, sweet tooth, bakery, sauces, organic, dairy (full pagination)
- `pnpm scrape:expand:detail` → PDP pass for rows missing `raw_payload`
- `pnpm score` → `core_scores` updated

Anyone refreshing the production deployment sees new products within seconds.

**Redeploy only when** you change code or `NEXT_PUBLIC_*` env vars. Pushing to GitHub (`oasis.git`) auto-deploys if the repo is linked to Vercel.

## Custom domain (optional)

Vercel → Project → **Domains** → add `yourdomain.com` and follow DNS instructions.
