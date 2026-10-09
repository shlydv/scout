import { z } from "zod";

/** Search request body. `prompt` is accepted from older clients and saved searches. */
export const searchInputSchema = z.object({
  q: z.string().trim().min(2).max(300).optional(),
  prompt: z.string().trim().min(2).max(300).optional(),
  limit: z.number().int().min(1).max(36).optional(),
  preferences: z.object({
    diet: z.string().max(100).optional(),
    healthContexts: z.array(z.string().max(100)).max(10).optional(),
    avoidIngredients: z.array(z.string().max(100)).max(30).optional(),
    budget: z.number().finite().positive().max(1_000_000).nullable().optional(),
  }).nullable().optional(),
}).refine(v => v.q || v.prompt, { message: "q is required" });

export type SearchInput = z.infer<typeof searchInputSchema>;
