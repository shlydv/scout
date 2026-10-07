# Decision search implementation plan

## Target
Vercel API → Supabase vector + full-text shortlist → current product evidence → Cloudflare Clef-flash decisions → validated matches and one ordering → web/mobile.

One submitted query uses one decision request for up to 24 candidates (49 questions). Each candidate has a match/unknown/reject decision and a relevance rubric. One shared question selects explicit numeric sort. No brand routing, nutrition regexes, goal weights, type centroids, DeepSeek verification, exploration, or automatic constraint relaxation. Empty and unavailable are different outcomes.

## Sequence
1. Add bounded, validated Cloudflare REST client and pure evaluation/ranking functions.
2. Add a retrieval-only SQL RPC; join current products for complete evidence and visibility. Retain embeddings and indexed full-text retrieval for recall, without domain filters.
3. Replace the active V2 pipeline; preserve response compatibility for web, mobile, and saved searches. Remove client intent classification and implicit goal reranking.
4. Isolate compatibility code and remove obsolete runtime dependencies where unused. Preserve catalog browsing, product health scoring, ingestion, and historical migrations: these are separate features, not search rules.
5. Test malformed answers, uncertainty, numeric ordering, complete evidence, provider failures, and integration seams. Typecheck and build.

## Evidence
Use products.ingredients_raw in full, nutrition with source and unit-bearing keys, all source attributes (including allergens and cross-contamination), name/brand/category, price and pack size, source URL and update time. Do not use inferred dietary flags or legacy trait vectors as proof. Do not truncate evidence to fit; reject oversize requests explicitly.

## Rollout
Apply migration 0041, configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_TOKEN (Workers AI permission) in Vercel, retain the existing embedding provider/model/dimensions, then deploy. No app hosting migration. Credentials must remain server-side. Cloudflare failure/quota exhaustion returns an unavailable response, never unevaluated products. One model operation is shared by identical in-flight requests; result caching is preference-isolated and versioned.

Default candidate budget is 24, not a guarantee of 24 results. Retrieval can miss matching products; validate recall on the Scout evaluation corpus before increasing it. No claim of catalog-wide cheapest ordering: numeric sort applies to evaluated matches. Larger candidate budgets require more requests and quota. Calibrate the provisional match threshold against labeled grocery examples before production promotion.

Offline enrichment and legacy scripts are retained where other consumers still use them; the new search runtime does not depend on their trait/rule outputs. Do not drop database tables or columns merely because online search stops reading them.

## Index maintenance
`pnpm search:build-index -- --skip-unchanged` now builds retrieval documents and embeddings directly from source product facts. It no longer calls DeepSeek for search traits, rebuilds category profiles, generates goal embeddings, clusters variants, or refreshes type centroids. Existing derived columns/tables remain intact for independent catalog features. Run `pnpm build:facets` separately when catalog browsing facets need refreshing. Existing embeddings can serve the initial rollout; rebuild incrementally to replace truncated legacy search documents. Keep the embedding model identical to the existing index during incremental updates; changing models requires a complete coordinated rebuild.

## Validation and availability
`pnpm search:decision-test` runs offline contract tests. `pnpm search:decision-eval` runs the small labeled evidence suite against the real Cloudflare endpoint and consumes quota; use before promotion. Run `pnpm exec tsc --noEmit` and `pnpm exec tsc --noEmit -p tsconfig.decision-tests.json`. The broader scripts typecheck has pre-existing failures; keep these separate from the new search checks.

Model-selected matches are probabilistic. The 0.8 acceptance threshold is provisional, not a proven allergy-safety guarantee. This change has no silent lexical fallback, no requirement relaxation and no inference that missing allergen data proves safety. Labels remain the evidence to verify before buying.

## Cloudflare setup for a new account
1. Create/sign into a free Cloudflare account. No DNS or domain transfer is required for REST inference.
2. Open Workers AI → Use REST API → Create a Workers AI API Token. Use the prefilled template; a custom token requires both Workers AI Read and Edit on your account.
3. Copy the Account ID and store it in Vercel as `CLOUDFLARE_ACCOUNT_ID`; store the token as `CLOUDFLARE_AUTH_TOKEN`. Never use a `NEXT_PUBLIC_` prefix. Configure Preview first.
4. Apply migration 0041 in the matching Supabase environment.
5. Run the live evidence suite and the repository catalog evaluation against the configured preview. Review actual input-token usage and latency before production. The repository catalog evaluator predates this refactor and its derived dietary-flag checks are not adequate proof of allergen correctness; manually label source evidence for a representative query/product set.
6. Merge/promote only after the migration, credentials, and live validation are ready. To roll back, redeploy the preceding application commit; migration 0041 is additive and can remain installed.

Official setup: https://developers.cloudflare.com/workers-ai/get-started/rest-api/

## Free-access integration
Rebased on main commit 84b4313 (Make Scout free with unlimited search and remove Plus billing). No per-user quota, signed-cookie gate, upgrade UI, or paid-plan requirement is introduced. Saved searches and history can still use accounts. Cloudflare's shared provider allowance may cause a temporary-unavailable response for everybody when exhausted; this is not a user quota or paywall. Existing technical input/candidate bounds keep individual searches bounded.

Migration 0041 restores the full-text GIN index dropped by 0039 because the new retrieval uses an indexed @@ predicate. Check EXPLAIN on the live database: HNSW comes from migration 0037; if absent in production, vector retrieval is an exact scan. Check remaining Supabase storage before rebuilding vector indexes.
