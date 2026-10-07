/**
 * L2 embedding layer — SEARCH_V2_PLAN.md §1, §7a, §16.2
 * Voyage AI (default) or OpenAI-compatible /embeddings endpoint.
 */
import { Agent, fetch as undiciFetch } from "undici";
import { EMBEDDING_DIM } from "@/lib/search/v2/types";

const dispatcher = new Agent({
  connect: { timeout: 20_000 },
  bodyTimeout: 60_000,
  headersTimeout: 30_000,
});

export type EmbeddingInputType = "query" | "document";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

type EmbeddingEndpoint = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: "voyage" | "openai" | "generic";
};

function resolveEmbeddingEndpoint(): EmbeddingEndpoint | null {
  const voyageKey =
    process.env.VOYAGE_API_KEY?.trim() ||
    (process.env.EMBEDDING_PROVIDER?.toLowerCase() === "voyage"
      ? process.env.EMBEDDING_API_KEY?.trim()
      : undefined);
  if (voyageKey) {
    return {
      apiKey: voyageKey,
      baseUrl: (process.env.EMBEDDING_BASE_URL ?? "https://api.voyageai.com/v1").replace(/\/+$/, ""),
      model: process.env.EMBEDDING_MODEL ?? "voyage-3.5",
      provider: "voyage",
    };
  }

  if (process.env.EMBEDDING_API_KEY?.trim()) {
    const baseUrl = (
      process.env.EMBEDDING_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
    const isVoyage = baseUrl.includes("voyageai.com");
    return {
      apiKey: process.env.EMBEDDING_API_KEY.trim(),
      baseUrl,
      model: process.env.EMBEDDING_MODEL ?? (isVoyage ? "voyage-3.5" : "text-embedding-3-small"),
      provider: isVoyage ? "voyage" : "openai",
    };
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    return {
      apiKey: process.env.OPENAI_API_KEY.trim(),
      baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
      model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      provider: "openai",
    };
  }

  return null;
}

let embedWarned = false;
const embedCache = new Map<string, number[]>();
/** In-flight requests keyed identically to embedCache — lets concurrent callers
 *  for the same text share ONE network round-trip (e.g. the speculative
 *  pipeline warm + the real fetchCandidatePool embed on a fast-path query). */
const embedInflight = new Map<string, Promise<number[]>>();

export function clearEmbeddingCache(): void {
  embedCache.clear();
  embedInflight.clear();
}

export function isEmbeddingConfigured(): boolean {
  return resolveEmbeddingEndpoint() !== null;
}

export async function embedTexts(
  texts: string[],
  inputType: EmbeddingInputType = "document",
): Promise<number[][]> {
  if (!texts.length) return [];
  const endpoint = resolveEmbeddingEndpoint();
  if (!endpoint) return texts.map(() => []);

  const { apiKey, baseUrl, model, provider } = endpoint;
  const dimensions = Number(process.env.EMBEDDING_DIM ?? EMBEDDING_DIM);

  const body: Record<string, unknown> = {
    model,
    input: texts,
  };
  if (provider === "voyage") {
    body.input_type = inputType;
    // voyage-3 family supports output_dimension; multilingual-2 / older do not.
    if (/voyage-(3|code-3)/.test(model)) body.output_dimension = dimensions;
  } else if (provider === "openai") {
    body.dimensions = dimensions;
  }

  // Retry on rate-limit / transient errors so a 429 never silently yields embedding-less rows.
  const MAX_ATTEMPTS = inputType === "query" ? 1 : 5;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await undiciFetch(`${baseUrl}/embeddings`, {
        method: "POST",
        dispatcher,
        signal: AbortSignal.timeout(inputType === "query" ? 8_000 : 60_000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status >= 500) {
        // Honor Retry-After when present, else exponential backoff (1s,2s,4s,8s).
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2 ** (attempt - 1) * 1000;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`Embeddings HTTP ${res.status} after ${MAX_ATTEMPTS} attempts`);
      }

      const payload = (await res.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(payload.error?.message ?? `Embeddings HTTP ${res.status}`);

      const sorted = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return sorted.map((row) => row.embedding ?? []);
    } catch (err) {
      lastErr = err;
      // Network error: brief backoff then retry.
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
        continue;
      }
    }
  }

  if (!embedWarned) {
    embedWarned = true;
    console.warn(
      `[embeddings] unavailable (${lastErr instanceof Error ? lastErr.message : lastErr}) — index will use lexical fallback`,
    );
  }
  return texts.map(() => []);
}

export async function embedText(text: string, inputType: EmbeddingInputType = "document"): Promise<number[]> {
  const key = `${text}\0${inputType}`;
  const cached = embedCache.get(key);
  if (cached) return cached;

  // Share an in-flight request so concurrent callers for the same text don't
  // each hit Voyage. On rejection the entry is cleared so the next call retries.
  const pending = embedInflight.get(key);
  if (pending) return pending;

  const p = embedTexts([text], inputType)
    .then(([vec]) => {
      const result = vec ?? [];
      if (result.length) {
        embedCache.set(key, result);
        if (embedCache.size > 512) embedCache.delete(embedCache.keys().next().value!);
      }
      return result;
    })
    .finally(() => embedInflight.delete(key));
  embedInflight.set(key, p);
  return p;
}

export async function embedTextBatch(
  texts: string[],
  batchSize = 64,
  inputType: EmbeddingInputType = "document",
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    const vecs = await embedTexts(chunk, inputType);
    out.push(...vecs);
  }
  return out;
}
