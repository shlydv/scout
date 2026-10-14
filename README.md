# Scout

**We read the back label so you don't have to.** Scout scores ~13,000 packaged foods sold on India's quick-commerce apps from their ingredient lists and nutrition panels. You can ask it things like "low sugar biscuits under ₹100" or "healthier than maggi" and get answers checked against the label.

Live: [oasis-phi-one.vercel.app](https://oasis-phi-one.vercel.app)

## What's on the site

| Page | What it does |
| --- | --- |
| `/search` | Free-form search. DeepSeek turns the question into a plan, SQL runs it over product facts, and goal queries are verified against the label. See [docs/planned-search.md](docs/planned-search.md). |
| `/catalog` | Browse every aisle, sorted by score, verdict or price. |
| `/shelves` | Twelve goal shortlists (high-protein snacks, kids' tiffin…), re-run daily. |
| `/brands` | Brands ranked by average score; each brand page lists its best, worst and any pack claims its label contradicts. |
| `/insights` | Counts from the labels: added sugar and palm oil by aisle, and "pack says / label says" contradictions. |
| `/product/[slug]` | Score, verdict, ingredients, nutrition, better swaps, WhatsApp share card. |
| `/basket`, `/compare` | Build a basket and compare products side by side. |

## How it works

1. **Catalog**: products, images, ingredients and nutrition live in the Supabase `products` table, the only source of truth. Missing labels are filled by OCR of pack images (Apple Vision locally, then DeepSeek structuring). Products are never deleted (the database refuses); hide one with `catalog_visible = false`.
2. **Scores**: `lib/scoring` (v9) blends an absolute score (nutrition, ingredients and additives, label claims) with a score relative to the product's cohort, and assigns a verdict: daily staple, good choice, occasional treat or skip. Cards and pages show the absolute score.
3. **Facts**: `lib/facts` maps each ingredient to plain concepts (added sugar, palm oil, maida, onion/garlic…) as present, may-contain or unknown, keeping the source line as evidence. Audits flag implausible nutrition, incomplete ingredient lists, and pack claims the label contradicts.
4. **Search**: plan → SQL → verify. Embeddings come from Voyage (voyage-3.5). Plans are cached per query.

## Stack

Next.js 16 (App Router) and Tailwind v4 on Vercel (Hobby, `sin1`). Supabase free tier for Postgres and auth. DeepSeek for search and label extraction. Voyage for embeddings. Sentry is optional.

## Local development

```bash
corepack enable
pnpm install
cp .env.example .env.local   # fill in the required block
pnpm dev                     # http://localhost:3000
```

Migrations live in `supabase/migrations`. Apply one with `pnpm db:apply supabase/migrations/<file>.sql`.

## Checks

```bash
pnpm typecheck                                    # app + scripts
pnpm search:test                                  # planned-search unit tests (offline)
node --import tsx scripts/free-access-regression.ts
pnpm search:eval                                  # 84-case search eval (uses DeepSeek, a few cents)
pnpm build
```

CI (`.github/workflows/checks.yml`) runs the typechecks, search tests and the free-access regression on every PR.

## Refreshing data

Run these in order after products are added or updated in the database:

```bash
pnpm label:deepseek && pnpm label:deepseek:promote   # structure OCR'd labels
pnpm score && pnpm score:sync && pnpm score:rank     # scores, verdicts, aisle ranks
pnpm search:build-index -- --skip-unchanged          # search index + embeddings
pnpm facts:sync -- --audits                          # facts, nutrition/completeness audits, label conflicts
```

The live site reads Supabase on every request, so new data needs no redeploy. Insights, shelves and brand pages refresh within a day.

## Repo layout

```
app/              routes (pages above, api/ for search, catalog, cron, admin)
components/       UI; search/, catalog/, insights/ hold page-specific pieces
lib/
  search/planned/ planner, SQL executor, verifier, presenter, plan cache
  facts/          ingredient → concept extraction, variant keys, pack parsing
  scoring/        v9 score engine and verdicts
  products/       catalog queries and caches
  insights/ brands/ shelves.ts   data behind those pages
  ocr/ lm/        label OCR and structuring
supabase/migrations/   SQL migrations (0001–0049)
scripts/          pipeline and maintenance scripts (see package.json)
eval/             search eval cases
ocr-pipeline/     Apple Vision OCR helper (Python, macOS)
data/             scoring rules, category baselines, reference foods
```

Deploying: see [DEPLOY.md](DEPLOY.md).

## Notes

- `pnpm-workspace.yaml` pins `nanoid@3.3.12` → `3.3.11` because 3.3.12 shipped a stray `.claude/` config. Remove once upstream publishes a clean release.
- Scores come from printed labels, not lab tests. Images are hotlinked from the retailer's CDN.
- Ingredient reference data: [Open Food Facts](https://world.openfoodfacts.org/).
