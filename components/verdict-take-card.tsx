import type { ScoreExplanation } from "@/lib/products/score-explain";
import type { VerdictId } from "@/lib/scoring/verdict";
import { ScoreRing } from "@/components/verdict-chips";
import { buildAutoSentence } from "@/lib/scoring/auto-sentence";
import { VERDICT_COLORS, verdictTitle } from "@/lib/scoring/verdict-display";
import { takeLines, bucketTake, actionableWatchLine } from "@/components/product-take-panel";
import { rankPhrase } from "@/lib/utils";

/** One deterministic Scout verdict, supported by label facts and category rank. */
export function VerdictTakeCard({
  verdict,
  score,
  absoluteScore,
  categoryRank,
  categorySize,
  categoryLabel,
  sublabelIds,
  deepseekChips,
  deepseekWhy,
  explanation,
  className,
}: {
  verdict: VerdictId;
  score?: number | null;
  absoluteScore?: number | null;
  categoryRank?: number | null;
  categorySize?: number | null;
  categoryLabel?: string | null;
  sublabelIds?: string[] | null;
  deepseekChips?: string[] | null;
  deepseekWhy?: string | null;
  explanation?: ScoreExplanation | null;
  className?: string;
}) {
  const abs = absoluteScore ?? score ?? null;
  const tc = VERDICT_COLORS[verdict].fg;
  const rank = rankPhrase(categoryRank ?? null, categorySize ?? null, categoryLabel ?? null);

  const autoSentence = buildAutoSentence(verdict, sublabelIds, deepseekChips);
  const lines = takeLines(explanation, deepseekWhy);
  const { good, watch } = bucketTake(lines);
  const items = [
    ...good.map((line) => ({ line, tone: "good" as const })),
    ...watch.map((line) => ({ line: actionableWatchLine(line), tone: "watch" as const })),
  ].slice(0, 4);

  if (!autoSentence && !items.length) return null;

  const bg = `color-mix(in srgb, ${tc} 9%, var(--color-bg))`;
  const border = `color-mix(in srgb, ${tc} 28%, transparent)`;

  return (
    <section
      className={`rounded-2xl border p-4 sm:p-5 ${className ?? ""}`}
      style={{ backgroundColor: bg, borderColor: border }}
    >
      <div className="flex items-start gap-4">
        {abs != null ? <ScoreRing score={abs} color={tc} /> : null}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {verdict ? (
              <span
                className="stamp-in rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-tight"
                style={{ backgroundColor: `color-mix(in srgb, ${tc} 16%, transparent)`, color: tc }}
              >
                {verdictTitle(verdict)}
              </span>
            ) : null}
            {rank ? (
              <span className="text-[11px] font-medium tracking-tight text-(--color-fg-muted)">
                {rank}
              </span>
            ) : (
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-fg-dim)">
                Quick take
              </p>
            )}
          </div>

          <h3 className="font-display mt-2 text-balance text-2xl leading-snug text-(--color-fg)">
            {autoSentence}
          </h3>

          {items.length > 0 ? (
            <ul className="mt-2.5 space-y-1 text-[14px] leading-relaxed text-(--color-fg-muted)">
              {items.map((item) => (
                <li key={`${item.tone}-${item.line}`} className="flex gap-2 rounded-lg px-1 py-0.5">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.tone === "good" ? tc : "var(--color-fg-dim)" }}
                    aria-hidden
                  />
                  <span>{item.line}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
