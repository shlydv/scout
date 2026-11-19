import { Agent, fetch as undiciFetch } from "undici";
import { formatIngredientsList } from "@/lib/ocr/format-ingredients";
import { buildLmStructureUserPayload } from "@/lib/ocr/lm-ingredients-anchor";
import { withLmStudioLock } from "@/lib/lm/studio-lock";

const DEFAULT_BASE = "http://127.0.0.1:1234/v1";
const DEFAULT_MODEL = "qwen2.5coder7b:2";

// Cloud LM APIs: timeouts only; certificates are always verified. On a network that inspects
// TLS, start Node with NODE_USE_SYSTEM_CA=1 so it trusts the system keychain (README).
// Local LM Studio (127.0.0.1) is HTTP, untouched.
const cloudDispatcher = new Agent({
  connect: { timeout: 20_000 },
  bodyTimeout: 180_000,
  headersTimeout: 60_000,
});

function isCloudUrl(url: string): boolean {
  return url.startsWith("https://") && !url.includes("127.0.0.1") && !url.includes("localhost");
}

export const LM_STRUCTURE_SYSTEM_PROMPT = `You are a rigid data processing utility. Extract both ingredients and nutrition facts from the following raw text into a valid, flat JSON object.

CRITICAL INGREDIENT RULES:
1. The "ingredients" field must contain the literal, technical, comma-separated list of raw materials (e.g., "milk solids, active lactic culture, sugar").
2. NEVER use the product name, marketing titles, front-of-pack descriptors, or brand names (like "Probiotic Dahi", "Potato Chips", or "Mango Juice") as the ingredients list.
3. If you see a prominent product title and a separate technical ingredients list, completely ignore the product title and extract ONLY the technical list.
4. Do not output markdown backticks, conversational preamble, or explanations. If a data item is missing, mark it null.

All nutrition numbers must be normalized per 100g (or per 100ml for liquids). If the label only shows per-serving values, convert them to per 100g using the serving size before outputting.

JSON Target Schema:
{
  "serving_size": string or null,
  "calories_100g": number or null,
  "protein_g_100g": number or null,
  "carbs_g_100g": number or null,
  "fat_g_100g": number or null,
  "fiber_g_100g": number or null,
  "sugar_g_100g": number or null,
  "sodium_mg_100g": number or null,
  "ingredients": string or null
}`;

export type StructuredLabel = {
  serving_size: string | null;
  calories_100g: number | null;
  protein_g_100g: number | null;
  carbs_g_100g: number | null;
  fat_g_100g: number | null;
  fiber_g_100g: number | null;
  sugar_g_100g: number | null;
  sodium_mg_100g: number | null;
  ingredients: string | null;
};

export type LmStudioOptions = {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Skip the cross-job file lock when caller orchestrates concurrency itself. */
  bypassLock?: boolean;
  /** Bearer token for cloud APIs (Groq, OpenAI-compatible providers). */
  apiKey?: string;
  /** Enable Retry-After / exponential backoff on 429 (cloud APIs). */
  rateLimit?: boolean;
};

function lmEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

/** Strip fences / preamble so JSON.parse can run on model output. */
export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function coerceString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Accept flat _100g keys or legacy unprefixed keys from older model outputs. */
export function normalizeStructuredLabel(raw: Record<string, unknown>): StructuredLabel {
  return {
    serving_size: coerceString(raw.serving_size),
    calories_100g:
      coerceNumber(raw.calories_100g) ?? coerceNumber(raw.calories),
    protein_g_100g:
      coerceNumber(raw.protein_g_100g) ?? coerceNumber(raw.protein_g),
    carbs_g_100g: coerceNumber(raw.carbs_g_100g) ?? coerceNumber(raw.carbs_g),
    fat_g_100g: coerceNumber(raw.fat_g_100g) ?? coerceNumber(raw.fat_g),
    fiber_g_100g: coerceNumber(raw.fiber_g_100g) ?? coerceNumber(raw.fiber_g),
    sugar_g_100g: coerceNumber(raw.sugar_g_100g) ?? coerceNumber(raw.sugar_g),
    sodium_mg_100g:
      coerceNumber(raw.sodium_mg_100g) ?? coerceNumber(raw.sodium_mg),
    ingredients: formatIngredientsList(coerceString(raw.ingredients)),
  };
}

const LM_RETRY_SUFFIX =
  "\n\nCRITICAL: Output JSON with numeric literals only (e.g. 12.5). No formulas, parentheses, or arithmetic expressions.";

type CallLmOpts = {
  apiKey?: string;
  /** Honor Retry-After (Groq) and exponential backoff on 429s. */
  rateLimit?: boolean;
};

async function callLm(
  baseUrl: string,
  model: string,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal,
  userContent: string,
  jsonMode: boolean,
  opts: CallLmOpts = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    messages: [
      { role: "system", content: LM_STRUCTURE_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

  const endpoint = lmEndpoint(baseUrl);
  const useCloudFetch = isCloudUrl(endpoint);

  async function send(currentBody: Record<string, unknown>): Promise<Response> {
    if (useCloudFetch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await undiciFetch(endpoint as any, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify(currentBody),
        dispatcher: cloudDispatcher,
      } as Parameters<typeof undiciFetch>[1]);
      return res as unknown as Response;
    }
    return await fetch(endpoint, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(currentBody),
    });
  }

  // Up to 5 retries on 429 honoring Retry-After; any other error throws.
  let res = await send(body);
  if (opts.rateLimit) {
    let attempt = 0;
    while (res.status === 429 && attempt < 5) {
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const wait = (retryAfter > 0 ? retryAfter : Math.pow(2, attempt)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
      res = await send(body);
    }
  }

  if (!res.ok && jsonMode) {
    const errBody = await res.text().catch(() => "");
    if (res.status === 400 && /response_format|json_object|json_schema|json_validate_failed/i.test(errBody)) {
      delete body.response_format;
      res = await send(body);
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LM ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("LM returned empty content");
  return content;
}

function parseStructuredContent(content: string): StructuredLabel {
  const jsonStr = extractJsonObject(content);
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  return normalizeStructuredLabel(parsed);
}

export async function structureLabelFromText(
  rawText: string,
  opts: LmStudioOptions = {},
): Promise<{ structured: StructuredLabel; rawResponse: string }> {
  const baseUrl = opts.baseUrl ?? process.env.LM_STUDIO_BASE_URL ?? DEFAULT_BASE;
  const model = opts.model ?? process.env.LM_STUDIO_MODEL ?? DEFAULT_MODEL;
  const temperature = opts.temperature ?? 0;
  const maxTokens = opts.maxTokens ?? 512;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const payloadText = buildLmStructureUserPayload(rawText);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const callOpts: CallLmOpts = { apiKey: opts.apiKey, rateLimit: opts.rateLimit };
  const work = async () => {
    let content = await callLm(
      baseUrl,
      model,
      temperature,
      maxTokens,
      controller.signal,
      payloadText,
      true,
      callOpts,
    );

    try {
      return { structured: parseStructuredContent(content), rawResponse: content };
    } catch {
      content = await callLm(
        baseUrl,
        model,
        temperature,
        maxTokens,
        controller.signal,
        payloadText + LM_RETRY_SUFFIX,
        true,
        callOpts,
      );
      return { structured: parseStructuredContent(content), rawResponse: content };
    }
  };

  try {
    return opts.bypassLock
      ? await work()
      : await withLmStudioLock(work, { label: "ocr:structure" });
  } finally {
    clearTimeout(timer);
  }
}
