import { detectNutritionAnomalies, nutritionMacrosUntrustworthy } from "@/lib/nutrition/anomaly";
import { countNutritionFields, nutritionIsSparse } from "@/lib/nutrition/completeness";
import { matchAdditives } from "@/lib/scoring/rules";
import type { RoleCohort } from "@/lib/scoring/role-cohort";
import { perServeFromNutrition } from "@/lib/scoring/per-serve";
import type { ProductNutrition } from "@/lib/supabase/types";
import type { ConcernEntry, SubScores } from "@/lib/supabase/types";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import { VERDICT_LABELS, type VerdictId } from "@/lib/scoring/verdict";

export type ScoreExplanation = {
  reasons: string[];
  tradeoffs: string[];
};

function sugar(n: ProductNutrition | null): number | null {
  const s = n?.sugar_g_100g ?? n?.added_sugar_g_100g;
  return typeof s === "number" ? s : null;
}

function pushUnique(list: string[], line: string) {
  if (!list.includes(line)) list.push(line);
}

/**
 * Build a short, role-aware explanation of why a product scores as it does.
 *
 * Role-cohort awareness is critical:
 *   - "adjunct" (masala, oil, ghee, ketchup, pickle, tea): per-100g claims are
 *     meaningless because real serving is 2-10g. We focus on ingredient quality
 *     and processing — NOT protein/fibre density.
 *   - "treat" (cola, ice cream, candy): high protein here is a curiosity, not a
 *     selling point — caveat any positive macro claims.
 *   - "staple"/"meal_replacement": per-100g and per-serve both matter.
 *   - "snack": both matter, lean per-serve.
 */
export function explainScore(opts: {
  score: number;
  verdict?: VerdictId | null;
  subscores?: SubScores | null;
  concerns?: ConcernEntry[] | Array<{ type?: string; message?: string; ingredient?: string; tier?: string }>;
  breakdown?: { notes?: string[]; hard_capped?: boolean } | null;
  nutrition: ProductNutrition | null;
  ingredients_raw: string | null;
  productName?: string | null;
  category?: string | null;
  subcategory?: string | null;
  role_cohort?: RoleCohort | null;
}): ScoreExplanation {
  const verdict = resolveProductVerdict({ verdict: opts.verdict, score: opts.score, name: opts.productName, category: opts.category, subcategory: opts.subcategory, hazardous: opts.breakdown?.hard_capped });
  const reasons: string[] = [];
  const n = opts.nutrition;
  const role = opts.role_cohort ?? null;
  const isAdjunct = role === "adjunct";
  const isTreat = role === "treat";
  const isSnack = role === "snack";
  const isMeal = role === "meal_replacement";

  const perServe = n ? perServeFromNutrition(n) : null;
  const serveG = perServe?.serving_g ?? null;

  const sugarG = sugar(n);
  const protein = n?.protein_g_100g;
  const fiber = n?.fiber_g_100g;
  const sodium = n?.sodium_mg_100g;
  const kcal = n?.energy_kcal_100g;
  const subs = opts.subscores;

  const nutritionCtx = {
    name: opts.productName ?? "",
    category: opts.category ?? null,
    subcategory: opts.subcategory ?? null,
  };
  const macroFields = n ? countNutritionFields(n) : 0;
  const macrosSparse = n ? nutritionIsSparse(n) : true;
  const macrosBad = n ? nutritionMacrosUntrustworthy(n, nutritionCtx) : true;

  // ── Data quality first ───────────────────────────────────────────
  if (!n || macroFields < 2 || macrosSparse) {
    pushUnique(reasons, "Not enough reliable nutrition on file to judge macros");
  } else if (macrosBad) {
    const all = detectNutritionAnomalies(n, nutritionCtx);
    // Surface the swap diagnosis explicitly when present — it's a clearer story
    // than the generic "untrustworthy"
    const swap = all.find((a) => a.code === "protein_carbs_swap");
    if (swap) {
      pushUnique(
        reasons,
        "Label scan likely swapped the protein and carbs columns — values aren't reliable. We'll re-scan this on the next OCR pass.",
      );
    } else {
      const top = all.find(
        (a) => a.field === "protein_g_100g" || a.severity === "critical",
      );
      pushUnique(
        reasons,
        top?.message ?? "Nutrition numbers look unreliable — don't trust protein/sugar claims here",
      );
    }
  }

  // ── Adjunct path: focus on ingredients, not macro density ─────────
  if (isAdjunct && !macrosBad) {
    pushUnique(
      reasons,
      `This is a seasoning — eaten in tiny amounts (${serveG ? `~${serveG}g per dish` : "1–10g per dish"}), so per-100g numbers don't mean much. What matters is what's in it.`,
    );

    // Sodium for adjuncts only matters if you'll consume a lot per dish (e.g. spice blends with salt)
    if (typeof sodium === "number" && sodium >= 5000) {
      pushUnique(reasons, `Heavily salted — sodium adds up if you cook with it daily`);
    }

    // Sugar in adjuncts only flagged if it's the dominant ingredient (very rare for masalas)
    if (sugarG != null && sugarG >= 25) {
      pushUnique(reasons, `Heavy on sugar (${sugarG}g per 100g) for a seasoning category`);
    }
  }

  // ── Non-adjunct macro reasoning ─────────────────────────────────
  if (!isAdjunct && !macrosBad) {
    if (sugarG != null) {
      if (sugarG >= 18) pushUnique(reasons, `High sugar (${sugarG}g per 100g)`);
      else if (sugarG >= 10) pushUnique(reasons, `Moderate sugar (${sugarG}g per 100g)`);
      else if (sugarG <= 5 && (isSnack || isMeal)) pushUnique(reasons, `Relatively low sugar (${sugarG}g per 100g)`);
    }

    if (typeof protein === "number") {
      if (protein >= 15 && !isTreat) {
        pushUnique(reasons, `Good protein density (${protein}g per 100g)`);
      } else if (protein >= 15 && isTreat) {
        // Treats with high "protein density" — usually a marketing curiosity (protein chocolates etc.)
        pushUnique(reasons, `Adds some protein (${protein}g per 100g) — but it's still a treat`);
      } else if (protein < 6 && (role === "staple" || isMeal)) {
        pushUnique(reasons, `Low protein for a staple (${protein}g per 100g)`);
      }
    }

    if (typeof fiber === "number" && fiber >= 5 && !isTreat) {
      pushUnique(reasons, `Decent fibre (${fiber}g per 100g)`);
    }

    if (typeof sodium === "number" && sodium >= 500) {
      pushUnique(reasons, `High sodium (${sodium}mg per 100g)`);
    }

    if (typeof kcal === "number" && kcal >= 450 && !isAdjunct) {
      pushUnique(reasons, `Calorie-dense (${kcal} kcal per 100g)`);
    }
  }

  // ── Ingredient quality (matters for everything, especially adjuncts) ─
  const flagged = matchAdditives(opts.ingredients_raw).filter(
    (m) => m.tier === "moderate" || m.tier === "hazardous",
  );
  if (flagged.length) {
    const names = flagged.slice(0, 2).map((m) => m.name);
    pushUnique(
      reasons,
      flagged.length === 1
        ? `Flagged additive: ${names[0]}`
        : `Flagged additives (${flagged.length}), including ${names.join(", ")}`,
    );
  } else if (isAdjunct) {
    // Clean adjuncts deserve credit
    pushUnique(reasons, "No flagged additives — clean ingredients for a seasoning");
  }

  for (const c of opts.concerns ?? []) {
    const entry = c as ConcernEntry & { message?: string };
    const name = entry.ingredient ?? entry.message;
    if (name && flagged.length === 0) {
      pushUnique(reasons, `Worth noting: ${name}`);
    }
  }

  // ── Subscore guidance (skipped for adjuncts since nutrition subscore is meaningless) ─
  if (!isAdjunct) {
    if (subs && subs.nutrition < 28) {
      pushUnique(reasons, "Nutrition profile is below typical for this aisle");
    }
  }
  if (subs && subs.additives < 18) pushUnique(reasons, "Additives pulled the score down");
  if (opts.breakdown?.hard_capped) pushUnique(reasons, "A high-risk additive capped the top score");

  // ── Marketing vs reality — applies to all ─
  const marketing =
    (opts.productName ?? "") +
    (typeof opts.breakdown === "object" && opts.breakdown && "notes" in opts.breakdown
      ? (opts.breakdown.notes ?? []).join(" ")
      : "");
  if (/protein|zero sugar|no added sugar|multigrain|healthy|diet/i.test(marketing)) {
    if (typeof protein === "number" && protein < 10 && /protein/i.test(marketing) && !isAdjunct) {
      pushUnique(reasons, `Marketed as high protein, but only ${protein}g per 100g on the label`);
    }
    if (sugarG != null && sugarG > 12 && /zero sugar|no added sugar/i.test(marketing)) {
      pushUnique(reasons, "Sugar claim on pack doesn't match the label numbers");
    }
  }

  if (reasons.length === 0) {
    pushUnique(reasons, verdict ? VERDICT_LABELS[verdict].description : "Based on the available label information");
  }

  const tradeoffs = verdict ? [VERDICT_LABELS[verdict].description] : [];

  return {
    reasons: reasons.slice(0, 4),
    tradeoffs: tradeoffs.slice(0, 2),
  };
}
