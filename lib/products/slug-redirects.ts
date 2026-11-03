import { requireSupabaseClient } from "@/lib/supabase/client";

/** The lookup runs before every product page, so it gets a hard budget. */
const LOOKUP_MS = 1500;

/**
 * Old slug → current slug, for the given slugs that products have moved away from
 * (migration 0051). Uses the anon client, which current_product_slugs() is granted to
 * and which fails fast (the admin client retries for seconds). A failed or slow lookup
 * is logged and treated as "no redirects", so old URLs fall back to a 404 rather than
 * holding up or breaking product pages.
 */
export async function currentProductSlugs(slugs: string[]): Promise<Map<string, string>> {
  const renamed = new Map<string, string>();
  if (!slugs.length) return renamed;
  try {
    const { data, error } = await requireSupabaseClient()
      .rpc("current_product_slugs", { p_slugs: slugs })
      .abortSignal(AbortSignal.timeout(LOOKUP_MS));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { old_slug: string; slug: string }[]) renamed.set(row.old_slug, row.slug);
  } catch (e) {
    console.error("[products] slug redirect lookup failed:", e instanceof Error ? e.message : e);
  }
  return renamed;
}

export async function currentProductSlug(slug: string): Promise<string | null> {
  return (await currentProductSlugs([slug])).get(slug) ?? null;
}
