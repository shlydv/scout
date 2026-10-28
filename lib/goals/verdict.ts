
export type FitVerdict = "strong" | "okay" | "weak";

export function fitVerdict(fit: number): FitVerdict {
  if (fit >= 70) return "strong";
  if (fit >= 45) return "okay";
  return "weak";
}

export function fitVerdictLabel(v: FitVerdict): string {
  switch (v) {
    case "strong":
      return "Strong goal fit";
    case "okay":
      return "Moderate goal fit";
    case "weak":
      return "Weak goal fit";
  }
}

export function goalFitColor(fit: number): string {
  return fit >= 70 ? "var(--score-good)" : fit >= 45 ? "var(--score-poor)" : "var(--color-fg-dim)";
}
