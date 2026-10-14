/** The small printed tag in front of a card line ("FITS", "WATCH"), as on the old leaderboards. */
export function LineTag({ tone, children }: { tone: "good" | "bad" | "plain"; children: React.ReactNode }) {
  const cls =
    tone === "good" ? "bg-(--color-good)/10 text-(--color-good)"
    : tone === "bad" ? "bg-(--color-bad)/10 text-(--color-bad)"
    : "bg-(--color-bg-soft) text-(--color-fg-dim)";
  return <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide ${cls}`}>{children}</span>;
}
