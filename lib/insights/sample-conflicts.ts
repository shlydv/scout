import { variantKey } from "@/lib/facts/variant-key";
import type { LabelConflict } from "@/lib/insights/data";

/** Up to `count` conflicts in random order, one per product line (pack sizes and repeat claims count once). */
export function sampleConflicts(pool: LabelConflict[], count: number): LabelConflict[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const seen = new Set<string>();
  return shuffled.filter(c => {
    const k = variantKey(c.brand, c.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, count);
}
