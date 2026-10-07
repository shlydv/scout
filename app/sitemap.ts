import type { MetadataRoute } from "next";
import { adminClient } from "@/lib/supabase/admin";
import { requireSupabaseClient } from "@/lib/supabase/client";

/** Service role when set, else anon — same fallback as product queries. */
function db() {
  try {
    return adminClient();
  } catch {
    return requireSupabaseClient();
  }
}

export const revalidate = 86400; // daily

const PAGE = 1000; // PostgREST max-rows per response

/** All visible product slugs + the core surfaces. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  const statics: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/search`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/insights`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/compare`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/stacks`, changeFrequency: "weekly", priority: 0.5 },
  ];

  const products: MetadataRoute.Sitemap = [];
  try {
    const supabase = db();
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from("products")
        .select("slug, updated_at")
        .eq("platform", "zepto")
        .eq("catalog_visible", true)
        .order("slug", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error || !data?.length) break;
      for (const row of data) {
        products.push({
          url: `${base}/product/${row.slug}`,
          lastModified: row.updated_at ?? undefined,
          changeFrequency: "weekly",
          priority: 0.7,
        });
      }
      if (data.length < PAGE) break;
    }
  } catch {
    // Sitemap should never take the site down — ship the static entries.
  }

  return [...statics, ...products];
}
