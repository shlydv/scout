import { NutritionFactsTable } from "@/components/nutrition-facts-table";
import { nutritionReviewStatus } from "@/lib/nutrition/review";
import { detectNutritionAnomalies, type NutritionContext } from "@/lib/nutrition/anomaly";
import { formatNutrientValue, resolveNutritionDisplay } from "@/lib/nutrition/nutrition-display";
import {
  judgeNutrition,
  NUTRIENT_VERDICT_COLOR,
  type JudgedNutrient,
} from "@/lib/nutrition/nutrient-judgment";
import type { RoleCohort } from "@/lib/scoring/role-cohort";
import type { ProductNutrition } from "@/lib/supabase/types";

function JudgedRow({ n }: { n: JudgedNutrient }) {
  const color = NUTRIENT_VERDICT_COLOR[n.verdict.kind];
  return (
    <div className="flex items-center gap-3 py-2" title={n.verdict.title}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="flex-1 text-[13.5px] text-(--color-fg)">{n.label}</span>
      <span className="text-[12px] tabular-nums text-(--color-fg-muted)">
        {formatNutrientValue(n.per100)}
        {n.unit}/100g
      </span>
      <span
        className="w-16 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wide"
        style={{ color }}
      >
        {n.verdict.label}
      </span>
    </div>
  );
}

export function PdpNutritionGlance({
  nutrition,
  netWeight,
  priceInr,
  name,
  category,
  subcategory,
  roleCohort,
}: {
  nutrition: ProductNutrition;
  netWeight?: string | null;
  priceInr?: number | null;
  name?: string;
  category?: string | null;
  subcategory?: string | null;
  roleCohort?: RoleCohort | null;
}) {
  const { rows, hasServe, serveQuantity, basisUnit, packLabel } = resolveNutritionDisplay(nutrition, netWeight);
  const review = nutritionReviewStatus(nutrition);
  const underReview = review === "partial" || review === "label_conflict";
  if (!rows.length) {
    return underReview ? (
      <div className="panel-soft rounded-2xl p-4 sm:p-5">
        <NutritionFactsTable nutrition={nutrition} netWeight={netWeight} />
      </div>
    ) : null;
  }

  const { watch, good, headline } = judgeNutrition(rows, roleCohort);
  const judged = [...watch, ...good];

  const ctx: NutritionContext | null = name ? { name, category, subcategory } : null;
  const anomalies = ctx ? detectNutritionAnomalies(nutrition, ctx) : [];
  const critical = anomalies.filter((a) => a.severity === "critical");
  const warnings = anomalies.filter((a) => a.severity === "warning");

  const metaParts = [
    packLabel !== "pack" ? packLabel : null,
    priceInr != null && priceInr > 0 ? `₹${priceInr}` : null,
    hasServe && serveQuantity ? `${serveQuantity}${basisUnit} serve` : null,
  ].filter(Boolean);

  return (
    <div className="panel-soft rounded-2xl p-4 sm:p-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-fg-dim)">
          Nutrition
        </p>
        {metaParts.length > 0 ? (
          <p className="mt-1 text-[12px] text-(--color-fg-muted)">{metaParts.join(" · ")}</p>
        ) : null}
      </div>

      {critical.length > 0 ? (
        <div className="mt-3 rounded-xl border border-(--color-bad)/30 bg-(--color-bad)/[0.06] px-3 py-2.5 text-[12px] leading-snug text-(--color-bad)">
          <p className="font-medium">{underReview ? "Nutrition is under review" : "Nutrition data looks wrong"}</p>
          <ul className="mt-1 list-inside list-disc opacity-90">
            {critical.map((a) => (
              <li key={a.code}>{a.code === "manual_review_incomplete"
                ? "Some label values are missing or disagree. A score is unavailable until these can be verified."
                : a.message}</li>
            ))}
          </ul>
        </div>
      ) : warnings.length > 0 ? (
        <div className="mt-3 rounded-xl border border-(--color-warn)/30 bg-(--color-warn)/[0.06] px-3 py-2.5 text-[12px] leading-snug text-(--color-warn)">
          {warnings.map((a) => a.message).join(" · ")}
        </div>
      ) : null}

      {/* Judged summary — the read-at-a-glance verdict, concerns first */}
      <p className="mt-4 text-[15px] font-medium leading-snug text-(--color-fg)">{headline}</p>
      {judged.length > 0 ? (
        <div className="mt-2 divide-y divide-(--color-line)/60">
          {judged.map((n) => (
            <JudgedRow key={n.id} n={n} />
          ))}
        </div>
      ) : null}

      {typeof nutrition.extra?.nutrition_gap_fill === "string" ? (
        <p className="mt-3 text-[11px] leading-snug text-(--color-fg-muted)">
          Some values missing on the pack label — gaps filled from a reference table.
        </p>
      ) : null}

      {/* Full numbers, one tap away — detail without the density up front */}
      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)">
          <span className="transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
          Full nutrition label
        </summary>
        <div className="mt-3">
          <NutritionFactsTable nutrition={nutrition} netWeight={netWeight} />
        </div>
      </details>
    </div>
  );
}
