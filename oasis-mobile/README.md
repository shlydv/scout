# Scout Mobile

Native iOS/Android app for [Scout](https://github.com/sahil-red/oasis2) — honest grocery scores and Ask Scout AI.

Built with **Expo Router** (React Native). No WebView: native screens, product grid, PDP, unlimited search, basket reports, saved searches, and alerts.

## Setup

1. **Install dependencies**

   ```bash
   cd oasis-mobile
   pnpm install
   ```

2. **Environment** — uses the **same Supabase project** as the web app (one database):

   ```bash
   # From repo root — copies NEXT_PUBLIC_* from .env.local → oasis-mobile/.env
   pnpm mobile:env
   ```

   This sets `EXPO_PUBLIC_API_URL` from `NEXT_PUBLIC_SITE_URL` (your Vercel deploy) and the same Supabase URL + anon key.

3. **Backend** (parent `oasis2` repo):

   - Run migration: `pnpm db:migrate` (includes `0010_profiles_billing.sql`)
   - Configure Supabase Auth: Google, Apple, Phone providers
   - Add redirect URL: `scout://` (mobile) and your site URL for OAuth

4. **Replace placeholder icons** in `assets/` before App Store submission (1024×1024 `icon.png`).

## Run

```bash
pnpm start
# i — iOS simulator
# a — Android emulator
```

For device builds:

```bash
pnpm ios    # requires Xcode
pnpm android
```

## Architecture

| Screen | API |
|--------|-----|
| Home | `GET /api/landing` |
| Browse | `GET /api/catalog/search` |
| Ask Scout | `POST /api/search/ai` (free, no sign-in or daily quota) |
| Product | `GET /api/products/[slug]` |
| Basket | `GET /api/products?slugs=` |

Auth: Supabase (Google, Apple, phone OTP). Sign-in is optional for search and used to save searches and manage alerts.

## App Store

- Bundle ID: `app.scout.grocery` (change in `app.json` if needed)
- Enable **Sign in with Apple** if Google sign-in is offered
- Privacy policy + account deletion flow required
