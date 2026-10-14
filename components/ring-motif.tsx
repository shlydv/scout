/**
 * The Scout score-ring motif as reusable brand texture — faint concentric rings
 * + an optional amber arc, echoing the score gauge. Pure decoration: aria-hidden,
 * pointer-events-none, low opacity. Drop into a `relative overflow-hidden` parent
 * and position with the className.
 */
export function RingGlyph({
  className,
  accent = true,
}: {
  className?: string;
  accent?: boolean;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      fill="none"
      className={`pointer-events-none text-(--color-line-strong) ${className ?? ""}`}
    >
      <circle cx="50" cy="50" r="47" stroke="currentColor" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="33" stroke="currentColor" strokeWidth="0.4" />
      {accent ? (
        <path
          d="M50 3 a47 47 0 0 1 41 24"
          stroke="var(--color-accent)"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.3"
        />
      ) : null}
    </svg>
  );
}
