/**
 * Normalize Zepto `formatted_packsize` for net_weight storage and gram parsing.
 * Strips leading "1 pack" / "1 pc" and uses the bracketed amount when present.
 */
export function normalizeFormattedPacksize(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let s = raw.trim().replace(/,/g, "");
  if (/^(null|none|n\/a)$/i.test(s)) return null;

  const oneUnit = /^1\s+(?:pack|pc|pcs|piece)\s*\(([^)]+)\)\s*$/i.exec(s);
  if (oneUnit) {
    s = oneUnit[1].trim();
  } else {
    const nPack = /^\d+\s+pack\s*\(([^)]+)\)\s*$/i.exec(s);
    if (nPack) s = nPack[1].trim();
    else {
      const oneSet = /^1\s+set\s*\(([^)]+)\)\s*$/i.exec(s);
      if (oneSet) s = oneSet[1].trim();
      else {
        const bare = /^1\s*\(([^)]+)\)\s*$/i.exec(s);
        if (bare) s = bare[1].trim();
      }
    }
  }

  if (/^\d+$/.test(s)) return `${s} g`;

  s = s.replace(/\s+/g, " ").trim();
  return s || null;
}
