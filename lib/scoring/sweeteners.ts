import { getIngredientNamesForAvoid } from "@/lib/scoring/ingredient-known";

/** True when an ingredient list contains an artificial / non-caloric sweetener. */
export function isArtificialSweetener(ingredientsText: string): boolean {
  // §A — Descriptive phrases that manufacturers use instead of specific sweetener names
  if (/\bnon[-\s]?caloric\s+sweeteners?\b|\bzero[-\s]?calorie\s+sweeteners?\b|\bintense\s+sweeteners?\b|\bartificial\s+sweeteners?\b/i.test(ingredientsText)) {
    return true;
  }

  // §B — Dictionary-driven: all ingredient-known entries with role="sweetener" below quality ceiling
  const names = getIngredientNamesForAvoid("artificial sweetener");
  if (names?.length) {
    return names.some((n) => boundedMatch(ingredientsText, n));
  }

  // §C — Fallback: bounded regex of the most common synthetic sweeteners + E-numbers.
  // E950-E968 covers acesulfame (950), aspartame (951), saccharin (954), sucralose (955),
  // steviol glycosides (960), neotame (961), maltitol (965), erythritol (968), etc.
  return /\b(?:aspartame|sucralose|acesulfame(?:\s+k| potassium)?|saccharin|neotame|steviol(?:\s+glycosides?)?)\b|\b(?:e|ins)?\s*(?:95[0-9]|96[0-8])\b/i.test(ingredientsText);
}

/** Word-boundary, case-insensitive match. Safer than includes() — prevents
 *  "strawberry" matching "berry" or "aspartame lite" matching "aspartame". */
function boundedMatch(haystack: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}\\b`, "i").test(haystack);
}
