import { inferRoleCohort } from "@/lib/scoring/role-cohort";
import { determineVerdict, type VerdictId } from "@/lib/scoring/verdict";

/** Use persisted V9 verdict or infer from legacy core score + product metadata. */
export function resolveProductVerdict(opts: {
  verdict?: string | null;
  score?: number | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  hazardous?: boolean;
}): VerdictId | null {
  if (opts.score == null || !Number.isFinite(opts.score)) return null;
  const valid = new Set<VerdictId>([
    "daily_staple",
    "good_choice",
    "occasional_treat",
    "skip",
  ]);
  if (opts.verdict && valid.has(opts.verdict as VerdictId)) {
    return opts.verdict as VerdictId;
  }
  const role = inferRoleCohort({
    name: opts.name,
    category: opts.category,
    subcategory: opts.subcategory,
  });
  return determineVerdict({
    absolute: opts.score,
    role_cohort: role,
    hazardous: opts.hazardous,
  });
}
