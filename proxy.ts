import { NextResponse, type NextRequest } from "next/server";
import { currentProductSlug } from "@/lib/products/slug-redirects";

/**
 * A product's old URL answers with a 308 to its current slug, query string included:
 * ?context= and ?q= carry the shopper's requirements onto the product page. The check
 * runs here because the page streams (a redirect thrown there reaches browsers and
 * crawlers as a 200 with a meta refresh) and layouts never see the query string.
 */
export async function proxy(request: NextRequest) {
  let slug: string;
  try {
    slug = decodeURIComponent(request.nextUrl.pathname.slice("/product/".length));
  } catch {
    return NextResponse.next();
  }
  const current = await currentProductSlug(slug);
  if (!current || current === slug) return NextResponse.next();
  const moved = request.nextUrl.clone();
  moved.pathname = `/product/${encodeURIComponent(current)}`;
  return NextResponse.redirect(moved, 308);
}

export const config = { matcher: "/product/:slug" };
