import { z } from "zod";

export const DECISION_MODEL = "clef";

export type DecisionQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };
export type DecisionRequest = { state: unknown; questions: Record<string, DecisionQuestion> };
const probability = z.number().finite().min(0).max(1);
const answerSchema = z.union([
  z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), probability) }),
  z.object({ type: z.literal("score"), score: z.number().finite() }),
]);
const responseSchema = z.object({
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number().finite().nonnegative().optional() }).passthrough().optional(),
});
export type DecisionResponse = z.infer<typeof responseSchema>;
export class DecisionUnavailableError extends Error {
  constructor(message = "Search is temporarily unavailable. Please try again later.") { super(message); }
}

export function validateDecisionResponse(raw: unknown, request: DecisionRequest): DecisionResponse {
  const result = responseSchema.parse(raw);
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = result.answers[id];
    if (!answer || answer.type !== question.type) throw new Error(`Missing or invalid answer: ${id}`);
    if (question.type === "choice" && answer.type === "choice") {
      const keys = Object.keys(question.criteria);
      if (!keys.includes(answer.choice) || keys.some(k => answer.probabilities[k] == null)
        || Object.keys(answer.probabilities).some(k => !keys.includes(k))) throw new Error(`Invalid choices: ${id}`);
      const sum = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.02) throw new Error(`Invalid probabilities: ${id}`);
      if (keys.some(k => answer.probabilities[k]! > answer.probabilities[answer.choice]! + 0.0001)) {
        throw new Error(`Inconsistent choice: ${id}`);
      }
    }
    if (question.type === "score" && answer.type === "score"
      && (answer.score < 0 || answer.score > question.criteria.length - 1)) throw new Error(`Invalid score: ${id}`);
  }
  return result;
}

export async function cloudflareDecide(request: DecisionRequest): Promise<DecisionResponse> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_AUTH_TOKEN?.trim();
  if (!account || !token) throw new DecisionUnavailableError("Search is not configured yet.");
  const count = Object.keys(request.questions).length;
  if (count < 1 || count > 64) throw new Error("Decision request must contain 1–64 questions");
  const body = JSON.stringify({ model: DECISION_MODEL, ...request });
  // Conservative byte bound, including instructions. Never let the service silently truncate labels.
  if (Buffer.byteLength(body, "utf8") > 48_000) throw new DecisionUnavailableError("Product evidence is too large to evaluate safely.");
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/@cf/cloudflare/${DECISION_MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body, signal: AbortSignal.timeout(12_000), cache: "no-store",
    });
    if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}`);
    const envelope = await response.json() as { success?: boolean; result?: unknown };
    if (envelope.success !== true) throw new Error("Cloudflare request failed");
    return validateDecisionResponse(envelope.result, request);
  } catch (error) {
    // Never log query, health preferences, product text, credentials, or raw provider bodies.
    console.error("[decision-search]", error instanceof Error ? error.name : "ProviderError");
    throw new DecisionUnavailableError();
  }
}
