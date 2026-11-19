import { requireSupabaseClient } from "@/lib/supabase/client";

/** Callers that look up only after a slug was not found can wait this long: the
 *  alternative is a "not found" page. proxy.ts, which runs before every product
 *  page, passes a much shorter budget. */
const LOOKUP_MS = 5000;

/** PRODUCT_SLUG_REDIRECT_PREFIXES: comma-separated prefixes that old slugs start with. */
export function redirectPrefixes(raw = process.env.PRODUCT_SLUG_REDIRECT_PREFIXES): string[] {
  return (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean);
}

/** Whether a slug could be an old one. With no prefixes configured every slug could be;
 *  with prefixes, current slugs skip the lookup entirely. */
export function mayBeOldSlug(slug: string, prefixes: string[]): boolean {
  return !prefixes.length || prefixes.some((p) => slug.startsWith(p));
}

/**
 * Old slug → current slug, for the given slugs that products have moved away from
 * (migration 0051). Uses the anon client, which current_product_slugs() is granted to
 * and which fails fast (the admin client retries for seconds). A failed or slow lookup
 * is logged and treated as "no redirects", so old URLs fall back to a 404 rather than
 * holding up or breaking product pages.
 */
export async function currentProductSlugs(slugs: string[], timeoutMs = LOOKUP_MS): Promise<Map<string, string>> {
  const renamed = new Map<string, string>();
  if (!slugs.length) return renamed;
  try {
    const { data, error } = await requireSupabaseClient()
      .rpc("current_product_slugs", { p_slugs: slugs })
      .abortSignal(AbortSignal.timeout(timeoutMs));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { old_slug: string; slug: string }[]) renamed.set(row.old_slug, row.slug);
  } catch (e) {
    console.error("[products] slug redirect lookup failed:", e instanceof Error ? e.message : e);
  }
  return renamed;
}

export async function currentProductSlug(slug: string, timeoutMs = LOOKUP_MS): Promise<string | null> {
  return (await currentProductSlugs([slug], timeoutMs)).get(slug) ?? null;
}
