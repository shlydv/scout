import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogBrowse } from "@/components/catalog/catalog-browse";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { getCachedCatalogMeta } from "@/lib/products/catalog-cache";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Browse aisles · Scout",
  description: "Every packaged-food aisle on India's quick-commerce shelves, scored from the back label.",
};

export default async function CatalogPage() {
  const meta = await getCachedCatalogMeta().catch(() => undefined);
  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 md:px-6 md:pt-10">
        <Suspense>
          <CatalogBrowse initialMeta={meta} />
        </Suspense>
      </div>
      <SiteFooter />
    </main>
  );
}
