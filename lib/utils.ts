import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Legacy grade/band fields are retained for stored-score compatibility only.
 * Product UI uses lib/scoring/verdict, never these independent thresholds. */
export type Grade = "A" | "B" | "C" | "D" | "F";
export type ScoreBand = "bad" | "poor" | "good" | "excellent";

export function gradeFromScore(score: number): Grade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function bandFromScore(score: number): ScoreBand {
  if (score >= 76) return "excellent";
  if (score >= 51) return "good";
  if (score >= 26) return "poor";
  return "bad";
}

/** "Best of 22 soya chunks" / "Top 9% of 22 soya chunks" / "#15 of 22 soya chunks" —
 *  the category-relative rank shown alongside the tier. Returns null when the cohort
 *  is too small to be meaningful. */
export function rankPhrase(rank: number | null, size: number | null, label?: string | null): string | null {
  if (!rank || !size || size < 6) return null;
  const cat = label ? label.toLowerCase() : "category";
  if (rank === 1) return `Best of ${size} ${cat}`;
  const pct = Math.round((rank / size) * 100);
  if (pct <= 33) return `Top ${Math.max(1, pct)}% of ${size} ${cat}`;
  return `#${rank} of ${size} ${cat}`;
}

/** Compact rank for dense grid cards: "Best" / "Top 9%" / "#15". */
export function rankShort(rank: number | null | undefined, size: number | null | undefined): string | null {
  if (!rank || !size || size < 6) return null;
  if (rank === 1) return "Best";
  const pct = Math.round((rank / size) * 100);
  return pct <= 33 ? `Top ${Math.max(1, pct)}%` : `#${rank}`;
}

// ────────────────────────────────────────────────────────────
// Additive tier (Yuka-inspired)
// ────────────────────────────────────────────────────────────

export type AdditiveTier = "risk-free" | "limited" | "moderate" | "hazardous";

/** Numeric penalty deducted from the 30-point Additives subscore per occurrence. */
export const ADDITIVE_TIER_PENALTY: Record<AdditiveTier, number> = {
  "risk-free": 0,
  limited: 3,
  moderate: 5,
  hazardous: 30, // fully zeros out the Additives axis
};

/**
 * Yuka rule: a single hazardous additive caps the total score at 49,
 * preventing the product from ever reaching the "Good" band regardless
 * of nutrition.
 */
export const HAZARDOUS_HARD_CAP = 49;
