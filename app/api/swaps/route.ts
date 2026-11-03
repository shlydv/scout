import { resolveShoppingContext, filterShoppingCandidates } from "@/lib/shopping/recommendations";
import { NextResponse } from "next/server";
import { findAlternatives, type SwapSuggestion } from "@/lib/products/alternatives";
import type { GoalId } from "@/lib/goals/types";
import { GOAL_PROFILES } from "@/lib/goals/types";
import { dietFromParam } from "@/lib/diet/types";
import { getProductsBySlugs, getProductsForSwaps } from "@/lib/products/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const HEADERS = { "Cache-Control": "private, no-store" };

const GOAL_IDS = new Set(GOAL_PROFILES.map((g) => g.id));

/** Cart / client: same-aisle swaps for one or more slugs. */
async function swapsResponse(params: URLSearchParams, tokens: string[] = []) {
  const contexts = tokens.length ? [await resolveShoppingContext(JSON.stringify(tokens))] : [];
  if (params.has("context") || params.has("q")) contexts.push(await resolveShoppingContext(params.get("context"), params.get("q")));
  const slugs = [...new Set((params.get("slugs")?.split(",").filter(Boolean) ?? []))].slice(0, 12);
  const goalParam = params.get("goal") ?? "balanced";
  const goal = (GOAL_IDS.has(goalParam as GoalId) ? goalParam : "balanced") as GoalId;
  const diet = dietFromParam(params.get("diet"));

  if (!slugs.length) {
    return NextResponse.json(
      { goal, swaps: {} as Record<string, SwapSuggestion[]> },
      { headers: HEADERS },
    );
  }

  const products = await getProductsBySlugs(slugs);
  const swaps: Record<string, SwapSuggestion[]> = {};

  // Group products by aisle to avoid N+1: one DB query per unique category combo.
  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const key = p.l3_category ?? `${p.category ?? ""}::${p.subcategory ?? ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  await Promise.all(
    [...groups.values()].map(async (group) => {
      let pool = await getProductsForSwaps(group[0], 200);
      for (const context of contexts) pool = await filterShoppingCandidates(pool, context);
      for (const current of group) {
        swaps[current.slug] = findAlternatives(current, pool, goal, 3, { diet });
      }
    }),
  );

  for (const slug of slugs) {
    if (!swaps[slug]) swaps[slug] = [];
  }

  return NextResponse.json(
    { goal, swaps, shoppingContext: contexts[0]?.token ?? (contexts.length ? "unavailable" : undefined) },
    { headers: HEADERS },
  );
}

export async function GET(request: Request) {
  return swapsResponse(new URL(request.url).searchParams);
}

/** Context tokens are sent in a body to avoid long URLs and intermediary caching. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.slugs) || body.slugs.some((s: unknown) => typeof s !== "string")
    || !Array.isArray(body.contexts) || body.contexts.length > 48
    || body.contexts.some((s: unknown) => typeof s !== "string" || s.length > 20000)) {
    return NextResponse.json({ error: "Invalid swap request" }, { status: 400, headers: HEADERS });
  }
  const params = new URLSearchParams({ slugs: body.slugs.slice(0, 12).join(","), goal: typeof body.goal === "string" ? body.goal : "balanced", diet: typeof body.diet === "string" ? body.diet : "any" });
  return swapsResponse(params, [...new Set<string>(body.contexts)]);
}
