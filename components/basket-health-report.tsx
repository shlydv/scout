"use client";

import { ArrowRight } from "lucide-react";
import { ScoreRing } from "@/components/verdict-chips";

import type { BasketAnalysis, SwapImpact } from "@/lib/products/basket-analysis";

/** A compact score pip (tinted number) for the before→after row. */
function Pip({ value, strong = false }: { value: number; strong?: boolean }) {
  const c = "var(--color-fg-muted)";
  return (
    <span
      className="inline-flex h-9 min-w-9 items-center justify-center rounded-xl border px-2 font-display text-lg tabular-nums leading-none"
      style={{
        color: c,
        borderColor: strong ? c : "var(--color-line)",
        backgroundColor: strong ? `color-mix(in srgb, ${c} 12%, var(--color-panel))` : "var(--color-panel)",
      }}
    >
      {value}
    </span>
  );
}

function DeltaChip({ children, good = true }: { children: React.ReactNode; good?: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={{
        color: good ? "var(--color-good)" : "var(--color-fg-muted)",
        borderColor: good ? "color-mix(in srgb, var(--color-good) 28%, var(--color-line))" : "var(--color-line)",
        backgroundColor: good ? "color-mix(in srgb, var(--color-good) 8%, transparent)" : "transparent",
      }}
    >
      {children}
    </span>
  );
}

/** The basket's "report card": a wellness grade for the whole cart now, and a
 *  before→after of what taking the suggested swaps would buy you. The payoff screen. */
export function BasketHealthReport({
  analysis,
  impact,
  swapsLoading,
}: {
  analysis: BasketAnalysis;
  impact: SwapImpact | null;
  swapsLoading: boolean;
}) {
  const score = analysis.avgCoreScore;
  if (score == null) return null;

  const rounded = Math.round(score);
  const color = "var(--color-fg-muted)";

  const facts: string[] = [];
  if (analysis.flaggedAdditiveSkus > 0) {
    facts.push(`${analysis.flaggedAdditiveSkus} with flagged additives`);
  }
  if (analysis.avgSugarG != null) facts.push(`~${analysis.avgSugarG.toFixed(1)}g sugar/100g`);
  if (analysis.avgFiberG != null) facts.push(`~${analysis.avgFiberG.toFixed(1)}g fibre/100g`);

  const scoreNow = impact?.scoreNow != null ? Math.round(impact.scoreNow) : null;
  const scoreAfter = impact?.scoreAfter != null ? Math.round(impact.scoreAfter) : null;
  const scoreGain = scoreNow != null && scoreAfter != null ? scoreAfter - scoreNow : 0;
  const sugarCut =
    impact?.sugarNowG != null && impact.sugarAfterG != null ? impact.sugarNowG - impact.sugarAfterG : 0;
  const skipsCleared = impact ? impact.skipsNow - impact.skipsAfter : 0;
  const hasUpside = impact != null && (scoreGain > 0 || sugarCut > 0.5 || skipsCleared > 0);

  return (
    <section className="panel-soft overflow-hidden rounded-2xl">
      <div className="flex items-center gap-4 p-5 sm:gap-5 sm:p-6">
        <div className="relative shrink-0">
          <ScoreRing score={rounded} color={color} />

        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-fg-dim)">
            Average Scout score
          </p>
          <p className="mt-1 font-display text-[1.6rem] leading-tight text-(--color-fg)">
            {rounded}/100 across scored items
          </p>
          <p className="mt-1 text-[13px] leading-snug text-(--color-fg-muted)">
            {analysis.summary[0] ?? "Based on the scored products in your basket."}
          </p>
          {facts.length > 0 ? (
            <p className="mt-1.5 text-[11.5px] leading-snug text-(--color-fg-dim)">{facts.join(" · ")}</p>
          ) : null}
        </div>
      </div>

      {swapsLoading ? (
        <div className="border-t border-(--color-line) bg-(--color-bg-soft)/60 px-5 py-3 sm:px-6">
          <p className="text-[12px] text-(--color-fg-dim)">Checking the aisles for better swaps…</p>
        </div>
      ) : hasUpside && scoreNow != null && scoreAfter != null ? (
        <div
          className="border-t px-5 py-4 sm:px-6"
          style={{
            borderColor: "color-mix(in srgb, var(--color-good) 25%, var(--color-line))",
            backgroundColor: "color-mix(in srgb, var(--color-good) 6%, var(--color-panel))",
          }}
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-good)">
            Swap to better picks
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <span className="inline-flex items-center gap-2">
              <Pip value={scoreNow} />
              <ArrowRight className="h-4 w-4 text-(--color-fg-dim)" />
              <Pip value={scoreAfter} strong />
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {scoreGain > 0 ? <DeltaChip>+{scoreGain} score</DeltaChip> : null}
              {sugarCut > 0.5 ? <DeltaChip>−{sugarCut.toFixed(1)}g sugar</DeltaChip> : null}
              {skipsCleared > 0 ? (
                <DeltaChip>
                  {skipsCleared} skip{skipsCleared === 1 ? "" : "s"} cleared
                </DeltaChip>
              ) : null}
              {impact && impact.priceDeltaInr !== 0 ? (
                <DeltaChip good={impact.priceDeltaInr < 0}>
                  {impact.priceDeltaInr > 0 ? `+₹${impact.priceDeltaInr}` : `−₹${Math.abs(impact.priceDeltaInr)}`}
                </DeltaChip>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-[11.5px] text-(--color-fg-muted)">
            Take the swaps under each item below to get there.
          </p>
        </div>
      ) : null}
    </section>
  );
}
