import { nutritionReviewStatus } from "@/lib/nutrition/review";
import {
  formatNutrientValue,
  resolveNutritionDisplay,
  type ResolvedNutritionRow,
} from "@/lib/nutrition/nutrition-display";
import {
  judgeNutrientRow as nutritionTone,
  NUTRIENT_VERDICT_COLOR as TONE_COLOR,
  type NutrientVerdict as NutritionTone,
} from "@/lib/nutrition/nutrient-judgment";
import type { ProductNutrition } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

function ValueCell({
  value,
  unit,
  muted,
  tone,
}: {
  value: number | undefined;
  unit: string;
  muted?: boolean;
  tone?: NutritionTone | null;
}) {
  const text = formatNutrientValue(value);
  const showUnit = value != null;
  const color = tone ? TONE_COLOR[tone.kind] : undefined;
  return (
    <span
      className={cn(
        "inline-flex items-baseline rounded-md px-1.5 py-0.5 tabular-nums",
        !tone && (muted ? "text-(--color-fg-muted)" : "text-(--color-fg)"),
      )}
      style={
        tone
          ? {
              color,
              backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            }
          : undefined
      }
      title={tone?.title}
    >
      {text}
      {showUnit ? (
        <span className="ml-0.5 text-[10px] font-normal opacity-75">{unit}</span>
      ) : null}
    </span>
  );
}

function NutritionRow({
  row,
  hasServe,
  hasPack,
}: {
  row: ResolvedNutritionRow;
  hasServe: boolean;
  hasPack: boolean;
}) {
  const tone = nutritionTone(row);
  const toneColor = tone ? TONE_COLOR[tone.kind] : undefined;
  return (
    <tr className="border-b border-(--color-line)/50 transition-colors last:border-0 hover:bg-(--color-bg-soft)/40">
      <td
        className={cn(
          "py-2 pr-2 align-middle",
          row.indent ? "pl-6 text-[11px] text-(--color-fg-muted)" : "pl-3",
          row.emphasis && !row.indent && "font-medium text-(--color-fg)",
        )}
      >
        <span className="flex items-center gap-1.5">
          {row.indent ? (
            <span className="text-(--color-fg-dim)" aria-hidden>
              ↳
            </span>
          ) : null}
          <span>{row.label}</span>
          {tone ? (
            <span
              className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
              style={{
                color: toneColor,
                borderColor: `color-mix(in srgb, ${toneColor} 45%, var(--color-line))`,
                backgroundColor: `color-mix(in srgb, ${toneColor} 10%, transparent)`,
              }}
              title={tone.title}
            >
              {tone.label}
            </span>
          ) : null}
        </span>
      </td>
      <td className="px-2 py-2 text-right align-middle">
        <ValueCell value={row.per100} unit={row.unit} muted tone={tone} />
      </td>
      {hasServe ? (
        <td className="px-2 py-2 text-right align-middle">
          <ValueCell value={row.perServe} unit={row.unit} />
        </td>
      ) : null}
      {hasPack ? (
        <td className="px-2 py-2 text-right align-middle">
          <ValueCell value={row.perPack} unit={row.unit} />
        </td>
      ) : null}
    </tr>
  );
}

export function NutritionFactsTable({
  nutrition,
  netWeight,
  className,
}: {
  nutrition: ProductNutrition;
  netWeight?: string | null;
  className?: string;
}) {
  const review = nutritionReviewStatus(nutrition);
  const { rows, hasServe, serveQuantity, basisUnit, hasPack, packLabel } = resolveNutritionDisplay(
    nutrition,
    netWeight,
  );

  if (!rows.length) {
    return (
      <p className="text-sm text-(--color-fg-muted)">
        {review === "label_conflict"
          ? "Available labels disagree. Nutrition values and a score are withheld until they can be verified."
          : review === "partial"
            ? "Label verification is incomplete. Nutrition values and a score are withheld until they can be verified."
            : "No nutrition values on file yet."}
      </p>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-(--color-line)", className)}>
      {review === "partial" || review === "label_conflict" ? (
        <p className="border-b border-(--color-line) px-3 py-3 text-xs text-(--color-fg-muted)">
          {review === "partial"
            ? "Only verified values are shown. Conflicting label values are omitted, and no score is available."
            : "The available labels conflict. Nutrition is under review and no score is available."}
        </p>
      ) : null}
      {basisUnit === "ml" && <p className="border-b border-(--color-line) px-3 py-2 text-xs text-(--color-fg-muted)">The label is declared by volume. No gram conversion or Scout score is inferred.</p>}
      {typeof nutrition.extra?.label_basis_note === "string" && <p className="border-b border-(--color-line) px-3 py-2 text-xs text-(--color-fg-muted)">{nutrition.extra.label_basis_note}</p>}
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-(--color-line) bg-(--color-bg-soft) text-[10px] uppercase tracking-[0.12em] text-(--color-fg-dim)">
            <th className="px-3 py-2.5 text-left font-medium">Nutrient</th>
            <th className="px-2 py-2.5 text-right font-medium tabular-nums">Per 100{basisUnit}</th>
            {hasServe ? (
              <th className="px-2 py-2.5 text-right font-medium tabular-nums">
                {serveQuantity ? `Per serve (${serveQuantity}${basisUnit})` : "Per serve"}
              </th>
            ) : null}
            {hasPack ? (
              <th className="px-2 py-2.5 text-right font-medium tabular-nums">
                Whole pack ({packLabel})
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <NutritionRow key={row.id} row={row} hasServe={hasServe} hasPack={hasPack} />
          ))}
        </tbody>
      </table>
      {!hasServe && !hasPack ? (
        <p className="border-t border-(--color-line) px-3 py-2 text-[11px] leading-snug text-(--color-fg-dim)">
          Serving size and pack weight not on file — per 100{basisUnit} only.
        </p>
      ) : !hasServe ? (
        <p className="border-t border-(--color-line) px-3 py-2 text-[11px] leading-snug text-(--color-fg-dim)">
          Serving size not on file — per-serve column omitted.
        </p>
      ) : null}
    </div>
  );
}
