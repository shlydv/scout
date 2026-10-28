import { goalFitColor } from "@/lib/goals/verdict";

/** Theme-aware tinted background for goal/score tiles. */
export function scoreTileSurface(fit: number): {
  backgroundColor: string;
  borderColor: string;
  accentColor: string;
} {
  const c = goalFitColor(fit);
  return {
    accentColor: c,
    backgroundColor: `color-mix(in srgb, ${c} 14%, var(--color-panel))`,
    borderColor: `color-mix(in srgb, ${c} 32%, var(--color-line))`,
  };
}
