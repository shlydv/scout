import { z } from "zod";
export const searchInputSchema = z.object({
  prompt: z.string().trim().min(2).max(1000),
  limit: z.number().int().min(1).max(24).optional(),
  // Accepted for older clients; no longer used to choose a search path.
  tier: z.string().optional(),
  preferences: z.object({
    diet: z.string().max(100).optional(),
    healthContexts: z.array(z.string().max(100)).max(10).optional(),
    avoidIngredients: z.array(z.string().max(100)).max(30).optional(),
    budget: z.number().finite().positive().max(1_000_000).nullable().optional(),
  }).nullable().optional(),
});
