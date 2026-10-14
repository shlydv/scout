/**
 * Zepto PDP embeds full ingredients + nutrition in Next.js RSC flight payloads
 * (`self.__next_f.push`), not in product-assortment-service product-detail JSON.
 */
import { isPlausibleIngredientsList } from "@/lib/nutrition/completeness";
import {
  nutrientFieldFromLabel,
  parseNutrientAmount,
  parseServingNutritionBlock,
} from "./parse-nutrition-block";
import type { ProductNutrition } from "@/lib/supabase/types";

/** Decode escaped RSC flight chunks from PDP HTML. */
export function decodeZeptoRscChunks(html: string): string {
  const parts: string[] = [];
  const re = /self\.__next_f\.push\(\[1,"((?:\\.|[^"])*)"\]\)/g;
  for (const m of html.matchAll(re)) {
    try {
      parts.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      // skip malformed chunk
    }
  }
  return parts.join("");
}

/** Extract {"key":"…","value":"…"} rows from RSC text (product detail section). */
export function extractZeptoRscAttributes(html: string): Record<string, string> {
  const blob = decodeZeptoRscChunks(html);
  const attrs: Record<string, string> = {};
  const re = /\{"key":"((?:\\.|[^"\\])*)","value":"((?:\\.|[^"\\])*)"\}/g;
  for (const m of blob.matchAll(re)) {
    const key = JSON.parse(`"${m[1]}"`) as string;
    const value = JSON.parse(`"${m[2]}"`) as string;
    if (key && value?.trim()) attrs[key] = value.trim();
  }
  return attrs;
}

function parseLabelValueSegment(trimmed: string): { label: string; value: number } | null {
  const colon = trimmed.indexOf(":");
  if (colon >= 0) {
    const label = trimmed.slice(0, colon).trim();
    const value = parseNutrientAmount(trimmed.slice(colon + 1));
    if (label && value != null) return { label, value };
  }

  const m =
    /^(.+?)\s+([-+]?\d+(?:\.\d+)?|<\s*\d+(?:\.\d+)?|TRACE|trace)\s*(?:\(([^)]*)\))?/i.exec(
      trimmed,
    ) ??
    /^(.+?)\s*\(([^)]+)\)\s+([-+]?\d+(?:\.\d+)?|<\s*\d+(?:\.\d+)?|TRACE|trace)/i.exec(trimmed);
  if (!m) {
    const labelFirst =
      /^(fat|protein|carbohydrate|carbs|sugar|energy|calorie|calories|sodium|fibre|fiber)\s+([-+]?\d+(?:\.\d+)?|<\s*\d+(?:\.\d+)?)\s*(?:gm|g|mg|kcal|k\s*cal)?/i.exec(
        trimmed,
      );
    if (labelFirst) {
      const value = parseNutrientAmount(labelFirst[2]);
      if (value != null) return { label: labelFirst[1], value };
    }
    return null;
  }

  let label: string;
  let valueRaw: string;
  if (m.length === 4 && /kcal|protein|carb|fat|sugar|sodium|fibre|fiber|vitamin|zinc/i.test(m[1])) {
    label = m[1].trim();
    valueRaw = m[2].trim();
  } else if (m[2] && /trace/i.test(m[2])) {
    label = m[1].trim();
    valueRaw = "0";
  } else {
    label = (m[1] ?? m[2] ?? "").trim();
    valueRaw = (m[2] ?? m[3] ?? "").trim();
  }

  const value = parseNutrientAmount(valueRaw);
  if (value == null) return null;
  return { label, value };
}

function applySegment(canonical: Record<string, number>, trimmed: string): void {
  const parsed = parseLabelValueSegment(trimmed);
  if (!parsed) return;
  const field = nutrientFieldFromLabel(parsed.label);
  if (field) canonical[field] = parsed.value;
}

/** Parse a Zepto RSC "nutrition information" one-liner. */
export function parseZeptoRscNutritionLine(text: string): ProductNutrition | null {
  if (!text?.trim()) return null;

  const canonical: Record<string, number> = {};

  const chunks = text.includes(";")
    ? text.split(/\s*;\s*/)
    : text.split(/,(?=\s*[A-Za-z])/);

  for (const seg of chunks) {
    applySegment(canonical, seg.trim());
  }

  if (Object.keys(canonical).length === 0) {
    return parseServingNutritionBlock(text.replace(/,/g, "\n"));
  }
  return { source: "platform", ...canonical };
}

export function mergeRscIntoZeptoFields(opts: {
  html: string;
  ingredients_raw: string | null;
  nutrition: ProductNutrition | null;
  attributes: Record<string, string>;
}): {
  ingredients_raw: string | null;
  nutrition: ProductNutrition | null;
  attributes: Record<string, string>;
} {
  const rsc = extractZeptoRscAttributes(opts.html);
  const attributes = { ...opts.attributes, ...rsc };

  let ingredients_raw = opts.ingredients_raw;
  const rscIng =
    rsc.ingredients ?? rsc.Ingredients ?? attributes.ingredients ?? attributes.Ingredients;
  if (rscIng && isPlausibleIngredientsList(rscIng)) {
    ingredients_raw = rscIng;
  } else if (!isPlausibleIngredientsList(ingredients_raw) && rscIng) {
    ingredients_raw = rscIng;
  }

  let nutrition = opts.nutrition;
  const nutText =
    rsc["nutrition information"] ??
    rsc["Nutrition Information"] ??
    rsc["nutritional information"];
  if (nutText) {
    const parsed = parseZeptoRscNutritionLine(nutText);
    if (parsed) nutrition = { ...nutrition, ...parsed, source: "platform" };
  }

  return { ingredients_raw, nutrition, attributes };
}
