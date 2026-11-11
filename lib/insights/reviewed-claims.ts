import { createHash } from "node:crypto";
import reviews from "@/lib/insights/reviewed-claims.json";
import type { Sql } from "@/lib/search/planned/db";

/**
 * A hand-check verdict on one label_conflicts row (docs/claims-review.md). It holds for the label
 * it was made on: when the product's facts change, its source_hash does too and the conflict is
 * hidden again until someone reviews it.
 */
export type ClaimReview = {
  product_id: string;
  claim: string;
  source_hash: string;
  verdict: "keep" | "drop";
  /** The card's second line as reviewed; replaces the generated one. */
  reality: string | null;
  reason: string;
  /** For people reading the file. */
  product: string;
};

export const CLAIM_REVIEWS = reviews as ClaimReview[];

const kept = CLAIM_REVIEWS.filter(r => r.verdict === "keep");

/** Changes whenever what may be published changes: part of the cache key of anything that shows conflicts. */
export const CLAIM_REVIEWS_VERSION = createHash("sha1").update(JSON.stringify(kept)).digest("hex").slice(0, 12);

/**
 * label_conflicts narrowed to reviewed and kept rows, with the reviewed wording: use it in place of
 * the table wherever a conflict reaches the site, so nothing unreviewed is ever published.
 */
export function reviewedConflicts(sql: Sql) {
  return sql`(
    select lc.product_id, lc.claim, coalesce(r.reality, lc.reality) reality, lc.kind, lc.severity
    from label_conflicts lc
    join unnest(
      ${kept.map(r => r.product_id)}::uuid[], ${kept.map(r => r.claim)}::text[],
      ${kept.map(r => r.source_hash)}::text[], ${kept.map(r => r.reality)}::text[]
    ) r(product_id, claim, source_hash, reality)
      on r.product_id = lc.product_id and r.claim = lc.claim and r.source_hash = lc.source_hash
  )`;
}
