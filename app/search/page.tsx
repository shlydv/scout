import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SearchView } from "@/components/search/search-view";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const CATALOG_KEYS = ["category", "subcategory", "usecase", "brand", "grade", "verdict", "sublabel", "sort", "maxprice", "min", "goal", "diet"];

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const q = one((await searchParams).q);
  return {
    title: q ? `${q} · Scout search` : "Search · Scout",
    description: "Describe what you want — low-sugar biscuits, high-protein snacks under ₹200 — and get answers checked against the back label.",
    robots: q ? { index: false } : undefined,
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const prompt = one(params.prompt);
  // Older links: ?prompt= (AI search) and catalog filter params now live at /catalog.
  if (prompt && !one(params.q)) redirect(`/search?q=${encodeURIComponent(prompt)}`);
  if (!one(params.q) && CATALOG_KEYS.some(k => one(params[k]))) {
    const qs = new URLSearchParams();
    for (const k of CATALOG_KEYS) if (one(params[k])) qs.set(k, one(params[k]));
    redirect(`/catalog?${qs}`);
  }

  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 md:px-6 md:pt-10">
        <Suspense>
          <SearchView initialQuery={one(params.q)} />
        </Suspense>
      </div>
      <SiteFooter />
    </main>
  );
}
