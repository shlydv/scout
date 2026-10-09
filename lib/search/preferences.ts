const PREFS_KEY = "scout-ai-preferences-v1";

export type AiSearchPreferences = {
  diet?: string;
  healthContexts?: string[];
  avoidIngredients?: string[];
  budget?: number | null;
};

export function readAiSearchPreferences(): AiSearchPreferences {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) as AiSearchPreferences : {};
  } catch {
    return {};
  }
}

export function writeAiSearchPreferences(prefs: AiSearchPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function clearAiSearchPreferences(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREFS_KEY);
}

const HEALTH_CONTEXT_LABELS: Record<string, string> = {
  diabetic: "diabetes-friendly",
  pcos: "PCOS",
  kids: "kids",
  gym: "gym",
  fat_loss: "diet / fat loss",
  bulk: "bulking",
  parents: "parents / elderly",
};

export function hasSavedPreferences(prefs: AiSearchPreferences | null | undefined): boolean {
  if (!prefs) return false;
  return Boolean(
    prefs.diet ||
      prefs.healthContexts?.length ||
      prefs.avoidIngredients?.length ||
      (prefs.budget != null && prefs.budget > 0),
  );
}

/** Short human phrases for the search bar hint (not sent verbatim to the model). */
export function savedPreferencePhrases(prefs: AiSearchPreferences): string[] {
  const parts: string[] = [];
  if (prefs.diet === "vegan") parts.push("vegan");
  else if (prefs.diet === "vegetarian") parts.push("vegetarian");
  for (const ctx of prefs.healthContexts ?? []) {
    parts.push(HEALTH_CONTEXT_LABELS[ctx] ?? ctx.replace(/_/g, " "));
  }
  for (const ing of prefs.avoidIngredients ?? []) {
    parts.push(`no ${ing}`);
  }
  if (prefs.budget != null && prefs.budget > 0) {
    parts.push(`under ₹${prefs.budget}`);
  }
  return parts;
}

export function emptyAiSearchPreferences(): AiSearchPreferences {
  return {};
}
