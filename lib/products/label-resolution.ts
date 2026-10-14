import type { OcrCompareSummary } from "@/lib/ocr/compare-platform";

export type LabelResolutionMeta = {
  nutrition_source?: string | null;
  ingredients_source?: string | null;
  lm_called?: boolean;
  compare?: OcrCompareSummary;
};

export function labelResolutionFromPayload(
  ocr_payload: Record<string, unknown> | null | undefined,
): LabelResolutionMeta | null {
  if (!ocr_payload || typeof ocr_payload !== "object") return null;
  const lr = ocr_payload.label_resolution;
  if (!lr || typeof lr !== "object") return null;
  return lr as LabelResolutionMeta;
}

/** True when LM pipeline tagged a field (includes filling previously missing fields). */
export function productHasLabelLmUpdate(
  ocr_payload: Record<string, unknown> | null | undefined,
): boolean {
  const lr = labelResolutionFromPayload(ocr_payload);
  if (!lr) return false;
  return lr.nutrition_source === "llm" || lr.ingredients_source === "llm";
}

/** True when label read materially disagreed with the listing (what users expect as “changed”). */
export function productHasLabelValueChange(
  ocr_payload: Record<string, unknown> | null | undefined,
): boolean {
  const lr = labelResolutionFromPayload(ocr_payload);
  if (!lr) return false;
  const c = lr.compare;
  if (c) {
    return c.nutrition === "different" || c.ingredients === "different";
  }
  return productHasLabelLmUpdate(ocr_payload);
}

export function productHasDeepseekLabel(
  ocr_payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!ocr_payload || typeof ocr_payload !== "object") return false;
  const label = ocr_payload.deepseek_label;
  if (!label || typeof label !== "object" || Array.isArray(label)) return false;
  const schema = (label as Record<string, unknown>).schema_version;
  return schema != null;
}
