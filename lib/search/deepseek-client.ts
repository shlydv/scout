import { Agent, fetch as undiciFetch } from "undici";
import { resolveDeepseekApiKey, type DeepseekUsageKind } from "@/lib/search/deepseek-keys";
import { createDeadline, throwIfAborted } from "./planned/runtime";

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-v4-flash";

const dispatcher = new Agent({
  connect: { rejectUnauthorized: false, timeout: 20_000 },
  bodyTimeout: 120_000,
  headersTimeout: 60_000,
});

export type DeepseekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type DeepseekChatOptions = {
  apiKey?: string;
  usageKind?: DeepseekUsageKind;
  baseUrl?: string;
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  jsonObject?: boolean;
  /** Set to false to skip DeepSeek-specific params (thinking) when calling
   *  OpenAI‑compatible providers like Groq. Defaults to true. */
  deepseekExtras?: boolean;
};

export type DeepseekChatResult = {
  content: string;
  usage: DeepseekUsage | null;
};

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("DeepSeek returned no JSON object");
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

export async function deepseekChat(opts: DeepseekChatOptions): Promise<DeepseekChatResult> {
  throwIfAborted(opts.signal);
  const apiKey = opts.apiKey ?? resolveDeepseekApiKey(opts.usageKind ?? "search");
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is missing");

  const deadline = createDeadline(opts.timeoutMs ?? 25_000, opts.signal);
  try {
    const baseUrl = (opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    const res = await undiciFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      dispatcher,
      signal: deadline.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 1200,
        ...(opts.jsonObject ? { response_format: { type: "json_object" } } : {}),
        ...(opts.deepseekExtras !== false ? { thinking: { type: "disabled" as const } } : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: DeepseekUsage;
      error?: { message?: string };
    };
    throwIfAborted(deadline.signal);
    if (!res.ok) throw new Error(body.error?.message ?? `DeepSeek HTTP ${res.status}`);
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek returned no message content");
    return { content, usage: body.usage ?? null };
  } finally {
    deadline.dispose();
  }
}

export function mergeUsage(
  a: DeepseekUsage | null | undefined,
  b: DeepseekUsage | null | undefined,
): DeepseekUsage | null {
  if (!a && !b) return null;
  return {
    prompt_tokens: (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0),
    completion_tokens: (a?.completion_tokens ?? 0) + (b?.completion_tokens ?? 0),
    total_tokens: (a?.total_tokens ?? 0) + (b?.total_tokens ?? 0),
  };
}
