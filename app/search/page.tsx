import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchView } from "@/components/search/search-view";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const params = await searchParams;
  const q = one(params.q) || one(params.prompt);
  return {
    title: q ? `${q} · Scout search` : "Search · Scout",
    description: "Describe what you want — low-sugar biscuits, high-protein snacks under ₹200 — and get answers checked against the back label.",
    robots: q ? { index: false } : undefined,
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 md:px-6 md:pt-10">
        <Suspense>
          {/* ?prompt= and catalog params are redirected in next.config.ts */}
          <SearchView initialQuery={one(params.q) || one(params.prompt)} />
        </Suspense>
      </div>
      <SiteFooter />
    </main>
  );
}
