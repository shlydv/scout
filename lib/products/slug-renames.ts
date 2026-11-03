/** Old → current slug for products that /api/products found under a slug they have moved away from. */
export function slugRenames(rows: { slug: string; renamed_from?: string[] }[]): Map<string, string> {
  return new Map(rows.flatMap((p) => (p.renamed_from ?? []).map((old): [string, string] => [old, p.slug])));
}
