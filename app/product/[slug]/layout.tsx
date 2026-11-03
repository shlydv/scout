import { permanentRedirect } from "next/navigation";
import { currentProductSlug } from "@/lib/products/queries";

/**
 * A product's old URL answers with a 308 to its current slug. The check lives here,
 * above loading.tsx, because the page streams: a redirect thrown there reaches
 * browsers and crawlers as a 200 with a meta refresh. Layouts never see the query
 * string, so an old URL's ?q= / ?goal= is dropped on the way.
 */
export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const current = await currentProductSlug(slug);
  if (current) permanentRedirect(`/product/${encodeURIComponent(current)}`);
  return children;
}
