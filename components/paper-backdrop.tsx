/**
 * Calm produce motif behind the catalog. Two soft blurred colour washes (warm
 * accent + a faint garden-green) plus a couple of half-cut fruit / leaf line
 * figures drifting in from the margins. aria-hidden, pointer-events-none,
 * desktop-only line art — atmosphere, never competing with the grid.
 *
 * Deliberately NOT rings (those live on the homepage) — soft organic shapes here.
 */
function CitrusHalf({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 150 96" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        {/* cut face */}
        <path d="M12 20 H138" />
        {/* outer rind */}
        <path d="M16 20 Q75 104 134 20" />
        {/* pith */}
        <path d="M27 26 Q75 88 123 26" />
        {/* segments fanning from the centre of the cut face */}
        <path d="M75 24 L40 44" />
        <path d="M75 24 L55 60" />
        <path d="M75 24 L75 68" />
        <path d="M75 24 L95 60" />
        <path d="M75 24 L110 44" />
      </g>
    </svg>
  );
}

function LeafSprig({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 150" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        {/* stem */}
        <path d="M47 146 C47 108 41 64 52 10" />
        {/* leaves, alternating */}
        <path d="M47 104 C24 100 16 80 22 66 C44 70 52 88 47 104 Z" />
        <path d="M49 78 C70 72 78 52 71 39 C50 45 44 62 49 78 Z" />
        <path d="M48 50 C29 46 23 30 28 19 C46 24 52 38 48 50 Z" />
      </g>
    </svg>
  );
}

export function PaperBackdrop() {
  // Fixed → viewport-anchored, so the washes + figures stay gently present in the
  // margins as the long grid scrolls past, instead of scattering down the page.
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* warm wash, upper-left */}
      <div
        className="absolute -left-40 -top-32 h-[480px] w-[480px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 11%, transparent), transparent)",
        }}
      />
      {/* garden-green wash, lower-right */}
      <div
        className="absolute -right-44 bottom-[-12%] h-[560px] w-[560px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in srgb, #4d7c0f 10%, transparent), transparent)",
        }}
      />
      {/* line-art produce in the margins — sits in the empty left rail (desktop only) */}
      <CitrusHalf className="absolute -left-12 top-1/2 hidden h-[160px] w-[250px] -translate-y-1/2 -rotate-[8deg] text-(--color-line-strong) opacity-80 lg:block" />
      <LeafSprig className="absolute right-[2.5%] top-[16%] hidden h-[200px] w-[125px] rotate-[12deg] text-(--color-line-strong) opacity-70 xl:block" />
      <LeafSprig className="absolute -left-4 bottom-[7%] hidden h-[150px] w-[95px] -rotate-[14deg] text-(--color-line-strong) opacity-50 xl:block" />
    </div>
  );
}
