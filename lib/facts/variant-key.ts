/**
 * Pack-size variant key: products that differ only in size or packaging
 * ("1 kg" vs "500 g", "Pouch" vs "Jar", "Pack of 2") share a key; flavours and
 * different products keep distinct names and therefore distinct keys.
 */
const PACK_WORDS = [
  "pouch", "jar", "tin", "bottle", "can", "cans", "box", "tub", "cup", "sachet", "sachets", "refill", "pet bottle",
  "tetra pack", "tetra", "family pack", "value pack", "mega pack", "jumbo pack", "economy pack", "combo", "multipack",
  "pack", "packs", "pcs", "pieces", "piece", "units", "unit", "kitted pack", "gable top pack", "carton",
];
const SIZE = /\b\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:g|gm|gms|grams?|kg|kgs|ml|l|ltr|litres?|liters?|pcs|pc|n|s)\b/g;
const PACK_OF = /\b(?:pack|set|combo|box)\s+of\s+\d+\b|\b\d+\s*(?:x|×)\s*\d*\b/g;

export function variantKey(brand: string | null | undefined, name: string): string {
  let n = ` ${name.toLowerCase()} `
    .replace(/[’']/g, "")
    .replace(/\([^)]*\)/g, m => (SIZE.test(m) || /pack|pouch|jar|tin/.test(m) ? " " : m))
    .replace(PACK_OF, " ")
    .replace(SIZE, " ");
  for (const w of PACK_WORDS) n = n.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  n = n.replace(/[^a-z0-9]+/g, " ").trim();
  const b = (brand ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Brand repeated inside the name ("MAGGI Rich Tomato Ketchup") must not split groups.
  if (b && n.startsWith(`${b} `)) n = n.slice(b.length + 1);
  return `${b}|${n}`;
}
