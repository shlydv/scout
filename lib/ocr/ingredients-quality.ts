import {
  formatIngredientsList,
  splitIngredientSegments,
} from "@/lib/ocr/format-ingredients";
import { extractIngredientsLineFromRaw as extractIngredientsLineFromRaw } from "@/lib/ocr/lm-ingredients-anchor";

const MARKETING_ONLY = [
  /^probiotic\s+dahi$/i,
  /^creamy\s+delight$/i,
  /^mango\s+juice$/i,
  /^potato\s+chips?$/i,
  /^natural\s+ingredients?$/i,
  /^100%\s+natural/i,
];

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function tokenOverlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const hit = a.filter((t) => setB.has(t)).length;
  return hit / Math.max(a.length, b.length);
}

/** Reject FOP marketing phrases masquerading as ingredient lists. */
export function isMarketingIngredientList(
  text: string | null | undefined,
  productName?: string | null,
): boolean {
  if (!text?.trim()) return true;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  for (const re of MARKETING_ONLY) {
    if (re.test(lower)) return true;
  }

  const segments = splitIngredientSegments(trimmed);
  if (segments.length < 2) return true;
  if (trimmed.length < 28 && segments.length < 3) return true;

  if (productName) {
    const nameTokens = normalizeTokens(productName);
    const ingTokens = normalizeTokens(trimmed);
    const overlap = tokenOverlapRatio(ingTokens, nameTokens);
    if (overlap >= 0.55 && segments.length <= 3) return true;
  }

  const technicalHints =
    /\b(milk|water|sugar|salt|oil|flour|solid|culture|stabilizer|emulsifier|INS|E\d{3,4}|acidity|regulator|permitted)\b/i;
  if (!technicalHints.test(trimmed) && segments.length <= 2 && trimmed.length < 80) {
    return true;
  }

  return false;
}

/** Best-effort ingredients string from raw OCR (regex), formatted. */
export function ingredientsFromRawOcr(rawText: string): string | null {
  return extractIngredientsLineFromRaw(rawText);
}

/** Pick LLM, regex-fallback, or listing ingredients; null if none are trustworthy. */
export function resolveIngredientsText(opts: {
  structuredIngredients: string | null | undefined;
  rawText: string;
  listingIngredients: string | null;
  productName?: string | null;
}): { text: string | null; source: "llm" | "listing" | "ocr" | "missing" } {
  const listing = opts.listingIngredients?.trim() || null;
  const fromRaw = ingredientsFromRawOcr(opts.rawText);

  let llm =
    opts.structuredIngredients != null
      ? formatIngredientsList(opts.structuredIngredients) ?? opts.structuredIngredients.trim()
      : null;

  if (llm && isMarketingIngredientList(llm, opts.productName)) {
    llm = null;
  }

  if (llm && !isMarketingIngredientList(llm, opts.productName)) {
    return { text: llm, source: "llm" };
  }

  if (fromRaw && !isMarketingIngredientList(fromRaw, opts.productName)) {
    return { text: fromRaw, source: "ocr" };
  }

  if (listing && !isMarketingIngredientList(listing, opts.productName)) {
    return { text: listing, source: "listing" };
  }

  return { text: null, source: "missing" };
}
