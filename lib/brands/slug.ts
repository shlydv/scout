/** URL slug for a brand; case-insensitive, so "PAPER BOAT" and "Paper Boat" share a page. */
export function brandSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
