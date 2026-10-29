import { judgeNutrientRow, NUTRIENT_VERDICT_COLOR } from "@/lib/nutrition/nutrient-judgment";
import { formatNutrientValue, resolveNutritionDisplay } from "@/lib/nutrition/nutrition-display";
import type { RoleCohort } from "@/lib/scoring/role-cohort";
import type { ProductNutrition } from "@/lib/supabase/types";

const MACROS: { id: string; label: string; unit: string }[] = [
  { id: "energy_kcal_100g", label: "Calories", unit: "" },
  { id: "protein_g_100g", label: "Protein", unit: "g" },
  { id: "carbs_g_100g", label: "Carbs", unit: "g" },
  { id: "fat_g_100g", label: "Fat", unit: "g" },
];

/**
 * The four numbers people actually want, big and instant — sits right under
 * Scout's Take so the essentials aren't buried in the collapsed label. Per 100g
 * (comparable across products); colour follows the same FSA judgment as the
 * detailed box (protein green when meaningful, fat/calories red when high).
 */
export function PdpMacroStrip({
  nutrition,
  netWeight,
  roleCohort,
}: {
  nutrition: ProductNutrition | null;
  netWeight?: string | null;
  roleCohort?: RoleCohort | null;
}) {
  if (!nutrition) return null;
  const { rows, basisUnit } = resolveNutritionDisplay(nutrition, netWeight);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const cells = MACROS.map((m) => {
    const row = byId.get(m.id);
    const verdict = row ? judgeNutrientRow(row, roleCohort) : null;
    return {
      ...m,
      value: row?.per100 ?? null,
      color: verdict ? NUTRIENT_VERDICT_COLOR[verdict.kind] : null,
    };
  });

  // Not worth a strip if we barely have data.
  if (cells.filter((c) => c.value != null).length < 2) return null;

  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3" aria-label={`Macros per 100${basisUnit}`}>
      {cells.map((c) => (
        <div
          key={c.id}
          className="panel-soft rounded-2xl px-2 py-3.5 text-center"
        >
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-(--color-fg-dim)">
            {c.label}
          </p>
          <p
            className="font-display mt-1.5 text-2xl leading-none tabular-nums sm:text-[1.7rem]"
            style={c.color ? { color: c.color } : undefined}
          >
            {c.value != null ? formatNutrientValue(c.value) : "—"}
            {c.value != null && c.unit ? (
              <span className="text-[12px] font-normal opacity-70">{c.unit}</span>
            ) : null}
          </p>
          <p className="mt-1.5 text-[9px] text-(--color-fg-dim)">per 100{basisUnit}</p>
        </div>
      ))}
    </div>
  );
}
