/** Parse catalog net_weight strings ("250 g", "1 L", "6 x 200 ml", "66.6 or 75 g") into g/ml/pcs. */
export type Pack = { qty: number; unit: "g" | "ml" | "pcs" };

const UNIT: Record<string, { unit: Pack["unit"]; mult: number }> = {
  g: { unit: "g", mult: 1 }, gm: { unit: "g", mult: 1 }, gms: { unit: "g", mult: 1 }, gram: { unit: "g", mult: 1 }, grams: { unit: "g", mult: 1 },
  kg: { unit: "g", mult: 1000 }, kgs: { unit: "g", mult: 1000 },
  ml: { unit: "ml", mult: 1 }, l: { unit: "ml", mult: 1000 }, ltr: { unit: "ml", mult: 1000 }, litre: { unit: "ml", mult: 1000 }, liter: { unit: "ml", mult: 1000 },
  pc: { unit: "pcs", mult: 1 }, pcs: { unit: "pcs", mult: 1 }, piece: { unit: "pcs", mult: 1 }, pieces: { unit: "pcs", mult: 1 }, unit: { unit: "pcs", mult: 1 }, units: { unit: "pcs", mult: 1 },
};

export function parsePack(netWeight: string | null | undefined): Pack | null {
  if (!netWeight) return null;
  const s = netWeight.toLowerCase().replace(/,/g, "").trim();
  // "6 x 200 ml" / "200 ml x 6" multipacks
  const multi = s.match(/(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*([a-z]+)/) ?? null;
  const multiRev = s.match(/(\d+(?:\.\d+)?)\s*([a-z]+)\s*[x×*]\s*(\d+)/) ?? null;
  if (multi && UNIT[multi[3]!]) {
    const u = UNIT[multi[3]!]!;
    return { qty: Number(multi[1]) * Number(multi[2]) * u.mult, unit: u.unit };
  }
  if (multiRev && UNIT[multiRev[2]!]) {
    const u = UNIT[multiRev[2]!]!;
    return { qty: Number(multiRev[1]) * Number(multiRev[3]) * u.mult, unit: u.unit };
  }
  // Take the first number followed (possibly after "or <n>") by a unit: "66.6 or 75 g" -> 66.6 g.
  const m = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:or\s*\d+(?:\.\d+)?\s*)?([a-z]+)/g)].find(x => UNIT[x[2]!]);
  if (!m) return null;
  const u = UNIT[m[2]!]!;
  const qty = Number(m[1]) * u.mult;
  return qty > 0 ? { qty, unit: u.unit } : null;
}

/** Price per 100 g/ml (or per piece for pcs). */
export function pricePer100(price: number | null | undefined, pack: Pack | null): number | null {
  if (price == null || !pack || pack.qty <= 0) return null;
  return pack.unit === "pcs" ? price / pack.qty : (price / pack.qty) * 100;
}
