export type ProductAudienceLabels = {
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

/** Infant / toddler SKUs — wrong for adult bulking, gym, fat-loss unless kids intent. */
export function isInfantOrBabyProductLabels(labels: ProductAudienceLabels): boolean {
  const hay = [labels.name, labels.brand, labels.category, labels.subcategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    /\b(baby|infant|toddler|newborn)\b/.test(hay) ||
    /\b(cerelac|lactogen|nan pro|farex|nestum|slurrp farm cereal for little)\b/i.test(hay) ||
    /\bfollow[\s-]?on formula\b/i.test(hay) ||
    /\binfant cereal\b/i.test(hay)
  );
}
