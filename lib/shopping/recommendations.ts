import type { ProductListItem } from "@/lib/products/queries";
import { searchSql } from "@/lib/search/planned/db";
import { executePlan } from "@/lib/search/planned/execute";
import { planQuery } from "@/lib/search/planned/plan";
import { loadVocabulary } from "@/lib/search/planned/vocabulary";
import { verifyInChunks } from "@/lib/search/planned/verify";
import { createShoppingContext, readShoppingContext, type ShoppingContext } from "./context";
import { lockRequirements, preserveRequirements, sensitiveRequest } from "./policy";

export type ResolvedShoppingContext = { active: boolean; token?: string; value?: ShoppingContext; blocked?: boolean };

/** Old q-only product URLs are re-planned on the server; invalid tokens fail closed. */
export async function resolveShoppingContext(token?: string | null, query?: string | null): Promise<ResolvedShoppingContext> {
  if (token?.startsWith("[")) {
    try {
      const tokens = JSON.parse(token) as unknown;
      if (!Array.isArray(tokens) || !tokens.length || tokens.length > 48 || tokens.some(t => typeof t !== "string")) return { active: true, blocked: true };
      const values = tokens.map(t => readShoppingContext(t));
      if (values.some(v => !v)) return { active: true, blocked: true };
      const valid = values as ShoppingContext[];
      const base = valid[0].plan;
      const combined = {
        ...base,
        exclude: [...new Set(valid.flatMap(v => v.plan.exclude))],
        require: [...new Set(valid.flatMap(v => v.plan.require))],
        claims_required: [...new Set(valid.flatMap(v => v.plan.claims_required))],
        numeric: valid.flatMap(v => v.plan.numeric),
        strict: valid.some(v => v.plan.strict),
        diet: {
          veg: valid.some(v => v.plan.diet.veg),
          vegan: valid.some(v => v.plan.diet.vegan),
          jain: valid.some(v => v.plan.diet.jain),
        },
        judge: valid.flatMap(v => v.plan.judge),
        relax: [],
      };
      const query = valid.map(v => v.query).join("; also required: ");
      const signed = createShoppingContext(query, combined);
      return { active: true, token: signed, value: readShoppingContext(signed)! };
    } catch { return { active: true, blocked: true }; }
  }
  if (token != null) {
    const value = readShoppingContext(token);
    return value ? { active: true, token, value } : { active: true, token, blocked: true };
  }
  if (!query?.trim()) return { active: false };
  try {
    const { plan, dropped } = await planQuery(query.slice(0, 1000), await loadVocabulary(searchSql()));
    if (dropped.some(x => /^(concept|claim|numeric):/.test(x))) return { active: true, blocked: true };
    const safePlan = lockRequirements(preserveRequirements(plan, query), query);
    const signed = createShoppingContext(query, safePlan);
    return { active: true, token: signed, value: readShoppingContext(signed)! };
  } catch { return { active: true, blocked: true }; }
}

/** Recheck the candidate pool against current DB facts; a signature is not a safety verdict. */
export async function filterShoppingCandidates<T extends Pick<ProductListItem, "id">>(pool: T[], context: ResolvedShoppingContext): Promise<T[]> {
  if (!context.active) return pool;
  if (!context.value || context.blocked || !pool.length) return [];
  const { query, plan } = context.value;
  try {
    const constraints = { ...plan, l3: [], subcategories: [], categories: [], brands: [], name_terms: [], comparison: null, relax: [] };
    const result = await executePlan(searchSql(), constraints, null, { productIds: pool.map(p => p.id), noRelax: true, limit: 400 });
    let confirmed = result.items.filter(p => p.confirmation === "confirmed");
    if (sensitiveRequest(plan, query) && confirmed.length) {
      const verified = await verifyInChunks(query, plan, confirmed);
      confirmed = confirmed.filter(p => {
        const verdict = verified.verdicts.get(p.product_id)?.v;
        return verdict === "good" || verdict === "ok";
      });
    }
    const allowed = new Set(confirmed.map(p => p.product_id));
    return pool.filter(p => allowed.has(p.id));
  } catch { return []; }
}
