/** Context is an opaque, server-authenticated value. Clients only carry it. */
export function productHref(slug: string, shoppingContext?: string | null, query?: string): string {
  const params = new URLSearchParams();
  if (shoppingContext) params.set("context", shoppingContext);
  if (query) params.set("q", query);
  return `/product/${encodeURIComponent(slug)}${params.size ? `?${params}` : ""}`;
}
