"use client";
import { cn } from "@/lib/utils";
import { catalogTierStyle, verdictTitle } from "@/lib/scoring/verdict-display";
import type { VerdictId } from "@/lib/scoring/verdict";
import { goalFitColor, fitVerdict, fitVerdictLabel } from "@/lib/goals/verdict";

/** Product score and the canonical Scout verdict. */
export function ScoreBadge({
  score,
  verdict,
  className,
}: { score: number;
  verdict?: VerdictId | null;
  className?: string;
}) {
  const { fill } = catalogTierStyle(score, verdict);
  return (
    <div
      className={cn(
        "flex h-12 min-w-12 flex-col items-center justify-center rounded-[10px] px-2.5 font-display text-[22px] font-bold leading-none tabular-nums text-white shadow-lg",
        className,
      )}
      style={{ backgroundColor: fill }}
      title={`${verdict ? verdictTitle(verdict) : "Scout score"}: ${score}/100}`}
    >
      <span>{score}</span>
      {verdict && <span className="text-[9px] leading-tight font-sans font-medium">{verdictTitle(verdict)}</span>}
    </div>
  );
}

/** Goal fit is separate from the overall Scout verdict. */
export function GoalFitBadge({
  fit,
  className,
  size = "card",
}: {
  fit: number;
  className?: string;
  size?: "card" | "inline" | "sm";
}) {
  const color = goalFitColor(fit);
  const sizeClass =
    size === "card" ? "text-[28px]" : size === "sm" ? "text-xl" : "text-2xl";
  return (
    <div
      className={cn(
        "flex flex-col items-end gap-0.5 rounded-xl border border-(--color-line) bg-(--color-panel)/92 px-2 py-1 shadow-sm backdrop-blur-md",
        className,
      )}
      title={fitVerdictLabel(fitVerdict(fit))}
      style={{ boxShadow: `0 4px 14px color-mix(in srgb, ${color} 20%, transparent)` }}
    >
      <span
        className={cn("font-display font-semibold leading-none tabular-nums", sizeClass)}
        style={{ color }}
      >
        {fit}
      </span>
      <span className="text-[8px] font-medium uppercase tracking-wider text-(--color-fg-dim)">
        fit
      </span>
    </div>
  );
}

export function ScorePending({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-(--color-line) bg-(--color-bg-soft) text-sm text-(--color-fg-muted)",
        compact ? "flex h-full items-center px-4 py-3" : "px-5 py-4",
      )}
    >
      {compact ? "Score pending" : "Score pending — waiting on nutrition data."}
    </div>
  );
}
