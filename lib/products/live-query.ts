/**
 * Query keys that change what a product page shows: the shopper's goal and diet, the shopping
 * context (?context, ?q) and the search the back link returns to (?q, ?prompt).
 *
 * next.config.ts rewrites /product/<slug> requests that carry any of these to the per-request
 * route (app/product/[slug]/live). Without them the page is the same for every visitor, so
 * app/product/[slug]/page.tsx renders it once and caches it, and crawlers walking the sitemap
 * no longer cost a render per visit. Add a key here when the product page starts reading it.
 */
export const PRODUCT_LIVE_QUERY_KEYS = ["goal", "diet", "context", "q", "prompt"] as const;
