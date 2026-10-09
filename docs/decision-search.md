# Decision search implementation plan (superseded)

> Superseded by [planned-search.md](planned-search.md). Kept for history.

## Target
Vercel API → Supabase vector + full-text shortlist → current product evidence → Cloudflare Clef decisions → validated matches and one ordering → web/mobile.

One submitted query evaluates up to 24 candidates independently, with four Cloudflare requests in flight at a time. Each request contains one product and the same three questions: match/unknown/reject, relevance, and explicit numeric sort. Final ordering uses the first response’s sort decision. Independent evidence and a consistent question schema passed the mixed-product regression where earlier shared-context and inconsistent-schema variants missed valid matches. No brand routing, nutrition regexes, goal weights, type centroids, DeepSeek verification, exploration, or automatic constraint relaxation. Empty and unavailable are different outcomes.

## Sequence
1. Add bounded, validated Cloudflare REST client and pure evaluation/ranking functions.
2. Add a retrieval-only SQL RPC; join current products for complete evidence and visibility. Retain embeddings and indexed full-text retrieval for recall, without domain filters.
3. Replace the active V2 pipeline; preserve response compatibility for web, mobile, and saved searches. Remove client intent classification and implicit goal reranking.
4. Isolate compatibility code and remove obsolete runtime dependencies where unused. Preserve catalog browsing, product health scoring, ingestion, and historical migrations: these are separate features, not search rules.
5. Test malformed answers, uncertainty, numeric ordering, complete evidence, provider failures, and integration seams. Typecheck and build.

## Evidence
Use products.ingredients_raw in full, nutrition with source and unit-bearing keys, all source attributes (including allergens and cross-contamination), name/brand/category, price and pack size, source URL and update time. Do not use inferred dietary flags or legacy trait vectors as proof. Do not truncate evidence to fit; reject oversize requests explicitly. Preflight all requests before inference (47 KB per product request, 200 KB total).

## Rollout
Apply migrations 0041 and 0042, configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_TOKEN (Workers AI permission) in Vercel, retain the existing embedding provider/model/dimensions, then deploy. No app hosting migration. Credentials must remain server-side. Cloudflare failure/quota exhaustion returns an unavailable response, never unevaluated products. One complete search evaluation is shared by identical in-flight requests; result caching is preference-isolated and versioned.

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
4. Apply migrations 0041 and 0042 in the matching Supabase environment.
5. Run the live evidence suite and the repository catalog evaluation against the configured preview. Review actual input-token usage and latency before production. The repository catalog evaluator predates this refactor and its derived dietary-flag checks are not adequate proof of allergen correctness; manually label source evidence for a representative query/product set.
6. Merge/promote only after the migration, credentials, and live validation are ready. To roll back, redeploy the preceding application commit; migrations 0041 and 0042 are additive and can remain installed.

Official setup: https://developers.cloudflare.com/workers-ai/get-started/rest-api/

## Free-access integration
Rebased on main commit 84b4313 (Make Scout free with unlimited search and remove Plus billing). No per-user quota, signed-cookie gate, upgrade UI, or paid-plan requirement is introduced. Saved searches and history can still use accounts. Cloudflare's shared provider allowance may cause a temporary-unavailable response for everybody when exhausted; this is not a user quota or paywall. Existing technical input/candidate bounds keep individual searches bounded.

Migration 0041 restores the full-text GIN index dropped by 0039 because the new retrieval uses an indexed @@ predicate. Migration 0042 adds a compact binary HNSW index because the live database had no vector index. It retrieves up to 400 approximate neighbors, then reranks using the original full-precision embeddings before merging with full-text candidates. No source vectors are replaced. Build the index concurrently as a separate statement on a live database to avoid blocking writes; the migration then detects it. This requires pgvector >= 0.7 (live version 0.8.0).

## Live rollout checks (2026-10-07)
- Applied 0041 and 0042 to the existing health Supabase project. The RPC remains service-role-only.
- 22,841 indexed product rows. Database 413 MB initially, 418 MB with full-text index, 427 MB with compact vector index (9,704 kB). No data or embeddings removed.
- One SQL timing sample improved from 17,910 ms to 1,880 ms. These are single measurements with different cache states, not a latency SLA.
- Compared exact versus compact retrieval using three stored product embeddings (biscuits, tofu, milk): all 24 nearest visible products overlapped in each sample (72/72). This is a small sanity check, not query-corpus recall validation.
- Earlier Flash Preview smoke checks (not the final model): biscuits returned 21 matches; gluten-free biscuits cheapest first returned three explicitly labeled products at INR 99/125/125; adding peanut and milk exclusions returned none; Amul milk under INR 100 returned seven Amul products in ascending price order.
- Fixed web search requesting catalog page size 96 instead of AI result size 24. Empty AI results no longer claim the entire catalog has no matches or suggest dropping essential dietary requirements.
- Preview builds run the synthetic live evidence suite using Vercel server-only credentials. Local and Production builds skip inference. No secrets are copied into the repo or browser.

### Provider validation findings
Clef-flash accepted a synthetic contradictory gluten-free claim despite an explicit wheat warning, even after clarifying evidence priority. The larger Clef model excluded that case and passed all 17 individual acceptance checks. A shared 24-product Clef context then excluded valid matches alongside contradictions; isolation alone also missed valid matches. Using the same three-question schema for every isolated product fixed that regression. This demonstrates context/schema sensitivity; it does not establish cross-product evidence leakage as the sole cause. Raw classification accuracy is reported separately from the final acceptance gate: reject and unknown both exclude a product, but differences remain visible in logs (`--strict-labels` makes them fatal). The 0.8 match threshold is unchanged. Final Clef validation on commit 026d312 passed all 17 individual inclusion/exclusion checks and all 24 mixed-product checks (zero acceptance failures, two raw-label differences). The suite consumed 33,926 input tokens in total. Its median measured operation took 305 ms; the complete 24-product evaluation took 4,231 ms. This small synthetic suite is not representative catalog-wide accuracy or load testing. The Vercel Preview build and application TypeScript check passed.

Final Clef Preview smoke check: gluten-free biscuits sorted by price returned five products at INR 99/99/125/129/150. Adding peanut/milk exclusions returned no confirmed matches. Amul milk under INR 100 returned 17 Amul milk/flavoured-milk products ordered from INR 25 to 80. Preview: https://oasis-kd407gpc3-sahil27gunwal-9351s-projects.vercel.app . Production application has not been promoted. A 24-second scheduling deadline plus the per-request 12-second timeout bounds inference within the route’s overall runtime budget.

Clef pricing is USD 0.24 per million input tokens versus 0.09 for Clef-flash (Cloudflare documentation checked 2026-10-07). Per-product isolation increases requests (up to 24 per uncached search) and repeats some query/instruction tokens. Earlier estimates based on one Flash request do not apply. Measure complete-search usage before publishing a daily free-search estimate; caching and coalescing still reduce repeated work.
