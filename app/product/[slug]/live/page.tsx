import type { Metadata } from "next";
import { ProductView, productMetadata, type ProductQuery } from "../product-view";

// /product/<slug>?goal=…, ?diet=…, ?context=…, ?q=… or ?prompt=… is rewritten here (next.config.ts):
// those change the page per visitor, so it renders on every request. The visitor's URL stays
// /product/<slug>?…; this path is internal.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return productMetadata((await params).slug);
}

export default async function ProductLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ProductQuery>;
}) {
  return <ProductView slug={(await params).slug} sp={await searchParams} />;
}
