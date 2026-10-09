# Planned search

Free-form search for Scout. Supersedes `docs/decision-search.md` (Cloudflare per-product decisions).

```
query ──► planner (DeepSeek, ~1.3s) ──► executor (SQL, ~0.4s) ──► verifier (DeepSeek, goals only, ~2s)
             │  closed vocabulary          │  whole visible catalog        │  judges against the
             │  validated, never guessed   │  facts + nutrition + price    │  shopper's own words
          query embedding (Voyage) runs in parallel with planning
```

## Why this shape

Language understanding lives in the LLM; code only executes a validated plan over
structured facts. There are no hand-written query rules. Synonyms ("maida", "palmolein",
"INS 955") are resolved **offline, per product, with the whole label in view**, so the
planner never has to know catalog vocabulary beyond a closed list of concepts.

## Components

| Piece | Where | What it does |
|---|---|---|
| Fact vocabulary | `lib/facts/vocab.ts` | ~37 concepts (gluten_source, palm_oil, added_sugar, …), 22 claims, 14 numeric fields. Shared contract between the facts pass and the planner. |
| Facts pass | `lib/facts/extract.ts`, `scripts/facts-extract.ts` | DeepSeek tags every ingredient with concepts. Model states present / may_contain / unknown; **absent is derived** and only when the list is complete. Also claims, claim-vs-ingredient conflicts, veg/vegan/jain, a short "kind". |
| Facts table | `product_facts` (migrations 0043–0045) | Arrays with GIN indexes, evidence, pack size, price per 100 g/ml, nutrition audit verdict, inline 128-byte embedding bits. |
| Planner | `lib/search/planned/plan.ts` | Query → plan JSON: l3 scope (qualified `Subcategory > l3`), brands, name terms, exclude/require concepts, strictness, claims, diet, numeric limits, sort, judge clauses, relaxation order, comparison. Every id is validated against the live vocabulary (`vocabulary.ts`). |
| Executor | `lib/search/planned/execute.ts` | Two-stage SQL. Stage 1 selects ids without reading TOASTed vectors (Hamming on `embedding_bits` for relevance; numeric sorts need no vectors). Stage 2 loads rows and exact cosine for ≤200 ids. Confirmation per item; relaxation in the planner's order; scope widens l3 → subcategory → category with a similarity guard. |
| Verifier | `lib/search/planned/verify.ts` | One batched call over everything that will be shown, for goals/comparisons/judge clauses and widened scopes. good / ok / no. |
| Adapter | `lib/search/planned/adapter.ts` | Maps to the `AiSearchResult` contract used by web and mobile; unconfirmed and relaxed items carry `ai_match_warning`. |

## Constraint semantics

- **exclude** concept: present → dropped; may_contain → dropped when `strict` (allergy), else warned; unknown or no facts → shown as *unconfirmed*, after confirmed results. Strict searches never show unconfirmed items.
- **require** concept: present → ok; unknown → unconfirmed; absent → dropped.
- **numeric** limits and **diet**: missing data → unconfirmed, never silently passed.
- **nutrient sorts/filters** ignore implausible labels: macros > 105 g, energy inconsistent with 4p+4c+9f, or flagged by the nutrition audit (`nutrition_suspect`).

## Operations

| Task | Command | Notes |
|---|---|---|
| Extract facts (new/changed products) | `pnpm facts:extract -- --all --out .cache/facts/facts-v1.jsonl` | Resumable JSONL. Full catalog ≈ $2.3 on deepseek-flash. Re-run with `--batch 2` to pick up failed batches. |
| Load facts | `pnpm facts:load -- --in .cache/facts/facts-v1.jsonl` | Idempotent upsert; computes pack size and price per 100. Embedding bits are filled by trigger / migration 0045. |
| Audit facts | `pnpm facts:audit` | Cross-checks concepts against raw-label text signals; 0.6–2.4% disagreement, mostly model-correct. |
| Audit nutrition | `pnpm facts:nutrition-audit` | LLM sanity check on statistical outliers only (~3.9k products, ≈ $0.15). |
| Try queries locally | `pnpm search:try "query" …` | Full path with stage timings. |
| Eval | `pnpm search:planned-eval [-- --hammer]` | 84 cases (`eval/search-cases.json`) + 287 adversarial queries → `.cache/eval/hammer.md`. |
| Query a deployment | `pnpm search:remote -- --url <deployment> "query"` | Uses `VERCEL_BYPASS_SECRET` for protected previews. |
| Apply a migration | `pnpm db:apply supabase/migrations/00xx.sql` | |

Environment: `SUPABASE_DB_URL` (use the **transaction pooler, port 6543** on Vercel), `DEEPSEEK_API_KEY`, `VOYAGE_API_KEY` + `EMBEDDING_*` (must match the index model, voyage-3.5 / 1024).

## Runbook

| Symptom | Likely cause | Action |
|---|---|---|
| Banner "Limited understanding right now" | Planner (DeepSeek) failing; search degrades to closest matches with no filters | Check DeepSeek balance/status; plans are cached in-process for 6 h. |
| 503 "Search is temporarily unavailable" | DB unreachable or statement timeout (8 s) | Check Supabase status and pooler connections; check DB size vs the 500 MB free-tier limit (read-only mode when exceeded). |
| Slow searches | Embedding provider slow (capped at 1.2 s after planning) or verifier on goal queries | `SEARCH_TELEMETRY=1` logs per-stage timings. |
| New products missing facts | Catalog sync ran without the facts pass | Run extract + load; products without facts are shown as unconfirmed for concept constraints. |
| Index rebuilt | `embedding_bits` stay in sync via trigger on `product_search_index.embedding` | Nothing to do; re-run migration 0045 to backfill if the trigger was dropped. |

Rollback: redeploy the previous production commit. Migrations 0043–0045 are additive; the old path does not read `product_facts`.

## Known limits

- Accuracy is bounded by label data: ~5% of labels are partial/garbage OCR, ~5% have suspect nutrition. Unknowns are surfaced, not hidden.
- Goal queries cost 2 LLM calls and take ~4–6 s; product queries take ~1.5–2.5 s.
- A plan is cached per process only; a shared plan cache (DB) would make repeat queries ~0.5 s.
