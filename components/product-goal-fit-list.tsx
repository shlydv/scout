"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { writeStoredGoal } from "@/lib/goals/storage";
import type { GoalFitRow } from "@/lib/goals/build-goal-rows";
import { GOAL_PROFILES, type GoalId } from "@/lib/goals/types";
import { scoreTileSurface } from "@/lib/score/surfaces";
import { cn } from "@/lib/utils";

export function ProductGoalFitList({
  rows,
  overall: _overall,
  className,
  cardClassName,
}: {
  rows: GoalFitRow[];
  overall: { fit: number; reasons: string[] } | null;
  className?: string;
  cardClassName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = (searchParams.get("goal") ?? "balanced") as GoalId;

  const select = (id: GoalId) => {
    writeStoredGoal(id);
    const p = new URLSearchParams(searchParams.toString());
    if (id === "balanced") p.delete("goal");
    else p.set("goal", id);
    p.delete("allow_eggs");
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const profileLabel = (id: GoalId) =>
    GOAL_PROFILES.find((g) => g.id === id)?.label ?? id;

  const profileShort = (id: GoalId) =>
    GOAL_PROFILES.find((g) => g.id === id)?.short ?? profileLabel(id);

  const gridGoals: {
    id: GoalId;
    label: string;
    fit: number;
    caption: string;
  }[] = [];

  const tileOrder: GoalId[] = [
    "gym",
    "fat-loss",
    "bulk",
    "diabetic",
    "pcos",
    "protein-budget",
    "kids",
  ];
  for (const id of tileOrder) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    gridGoals.push({
      id: row.id,
      label: profileShort(row.id),
      fit: row.fit,
      caption: row.primaryMetric,
    });
  }

  const activeGoal = gridGoals.find((g) => g.id === active);
  const goalSummary = summarizeGoals(gridGoals);

  // Treats and snacks legitimately score 0 for most goals — render those as a
  // quiet chip row instead of a column of alarming zeros.
  const strongGoals = [...gridGoals].filter((g) => g.fit >= 30).sort((a, b) => b.fit - a.fit);
  const weakGoals = gridGoals.filter((g) => g.fit < 30);

  if (!gridGoals.length) {
    return (
      <p className={cn("mt-6 rounded-xl border border-(--color-line) bg-(--color-bg-soft) px-4 py-3 text-sm text-(--color-fg-muted)", className)}>
        Score pending — goal fit will appear once nutrition is available.
      </p>
    );
  }

  return (
    <section className={cn("mt-6", className)}>
      <div className={cn("panel-soft rounded-2xl p-4 sm:p-5", cardClassName)}>
        <div className={cn(strongGoals.length > 0 && "border-b border-(--color-line) pb-4")}>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-fg-dim)">
              Goals at a glance
            </p>
            <p className="mt-1.5 text-[14px] font-medium leading-snug text-(--color-fg)">
              {goalSummary}
            </p>
            {activeGoal ? (
              <p className="mt-1 text-[12px] leading-snug text-(--color-fg-muted)">
                Selected: {activeGoal.caption}
              </p>
            ) : null}
          </div>
        </div>

        {strongGoals.length > 0 ? (
          <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {strongGoals.map((g) => (
              <GoalFitRowCompact
                key={g.id}
                label={g.label}
                fit={g.fit}
                active={active === g.id}
                onSelect={() => select(g.id)}
              />
            ))}
          </ul>
        ) : null}

        {weakGoals.length > 0 ? (
          <div className={cn("flex flex-wrap items-center gap-1.5", strongGoals.length > 0 ? "mt-3 border-t border-(--color-line) pt-3" : "mt-3")}>
            <span className="text-[11px] text-(--color-fg-dim)">Not a fit:</span>
            {weakGoals.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => select(g.id)}
                aria-pressed={active === g.id}
                title={`${g.label}: fit ${g.fit}/100 — see the product through this goal`}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
                  active === g.id
                    ? "border-(--color-line-strong) bg-(--color-bg-soft) text-(--color-fg)"
                    : "border-(--color-line) text-(--color-fg-muted) hover:border-(--color-line-strong) hover:text-(--color-fg)",
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function summarizeGoals(goals: Array<{ label: string; fit: number }>): string {
  const sorted = [...goals].sort((a, b) => b.fit - a.fit);
  const meaningful = sorted.filter((g) => g.fit >= 30).slice(0, 2);

  if (meaningful.length === 0) {
    return "No strong fit for the tracked goals. See the Scout verdict for the overall assessment.";
  }

  const strongText = meaningful.map((g) => `${g.label} (${g.fit})`).join(", ");
  if (meaningful.length < Math.min(2, goals.length)) {
    return `Only meaningful for ${strongText}.`;
  }
  return `Best fit: ${strongText}.`;
}

function GoalFitRowCompact({
  label,
  fit,
  active,
  onSelect,
}: {
  label: string;
  fit: number;
  active: boolean;
  onSelect: () => void;
}) {
  const surface = scoreTileSurface(fit);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={cn(
          "group grid w-full grid-cols-[84px_minmax(0,1fr)_38px] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition sm:grid-cols-[100px_minmax(0,1fr)_42px]",
          active
            ? "bg-(--color-bg-soft) ring-1 ring-(--color-line-strong)"
            : "hover:bg-(--color-bg-soft)/70",
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate text-[13px] font-medium",
            active
              ? "text-(--color-fg)"
              : "text-(--color-fg-muted) group-hover:text-(--color-fg)",
          )}
        >
          {label}
        </span>
        <span className="h-1.5 min-w-0 overflow-hidden rounded-full bg-(--color-line)/50">
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.max(2, Math.min(100, fit))}%`,
              backgroundColor: surface.accentColor,
            }}
          />
        </span>
        <span
          className="text-right font-display text-xl tabular-nums leading-none"
          style={{ color: surface.accentColor }}
        >
          {fit}
        </span>
      </button>
    </li>
  );
}
