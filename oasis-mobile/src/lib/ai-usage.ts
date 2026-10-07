import AsyncStorage from "@react-native-async-storage/async-storage";

/** Mirrors web `lib/search/ai-usage.ts` keys so prefs sync if users use both. */

const PREFS_KEY = "scout-ai-preferences-v1";

export type AiSearchPreferences = {
  diet?: string;
  healthContexts?: string[];
  avoidIngredients?: string[];
  budget?: number | null;
};

export async function readAiSearchPreferences(): Promise<AiSearchPreferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as AiSearchPreferences) : {};
  } catch {
    return {};
  }
}
