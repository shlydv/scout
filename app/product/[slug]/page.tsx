import type { Metadata } from "next";
import { ProductView, productMetadata } from "./product-view";

// The plain product URL (no goal, diet or shopping context) is the same for everyone: rendered on
// first visit, then cached for a day. Links that carry those parameters are rewritten to ./live
// (next.config.ts, lib/products/live-query.ts), so reading searchParams here is not needed.
export const revalidate = 86400;
export const maxDuration = 60;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return productMetadata((await params).slug);
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  return <ProductView slug={(await params).slug} sp={{}} />;
}
