/** Parse a serving-size string into declared grams; volume needs an explicit mass equivalent. Returns null if unknown. */
export function parseServingSizeGrams(servingSize: string | null | undefined): number | null {
  if (!servingSize?.trim()) return null;
  const s = servingSize.trim().toLowerCase();

  const combined = s.match(
    /(\d+(?:\.\d+)?)\s*(?:g|gm|gram|grams|kg)\b/i,
  );
  if (!combined) return null;

  const n = Number(combined[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = combined[0].replace(combined[1], "").trim().toLowerCase();
  if (unit.includes("kg")) return n * 1000 <= 5000 ? n * 1000 : null;
  if (unit.includes("g")) return n <= 2000 ? n : null;

  return n <= 2000 ? n : null;
}

/** Scale a per-100g nutrient to per-serving; never returns NaN. */
export function scalePer100gToServe(
  per100g: number | null | undefined,
  serveGrams: number | null,
): number | null {
  if (per100g == null || serveGrams == null) return null;
  if (!Number.isFinite(per100g) || !Number.isFinite(serveGrams) || serveGrams <= 0) {
    return null;
  }
  const scaled = per100g * (serveGrams / 100);
  if (!Number.isFinite(scaled)) return null;
  return Math.round(scaled * 100) / 100;
}
