import { productHref } from "@/lib/shopping/links";
import Image from "next/image";
import Link from "next/link";
import { GoalFitBadge, ScoreBadge } from "@/components/score-display";
import type { GoalId } from "@/lib/goals/types";
import { cn } from "@/lib/utils";
import type { SwapSuggestion } from "@/lib/products/alternatives";
import type { ProductListItem } from "@/lib/products/queries";

export function SwapPanel({
  current,
  shoppingContext,
  suggestions,
  compact,
  goal = "balanced",
  title = "Swaps",
  description,
  layout = "list",
  gridColumns = 3,
}: {
  current: ProductListItem;
  shoppingContext?: string;
  suggestions: SwapSuggestion[];
  compact?: boolean;
  goal?: GoalId;
  title?: string;
  description?: string;
  layout?: "list" | "grid";
  gridColumns?: 3 | 4;
}) {
  if (suggestions.length === 0) return null;

  const curSugar =
    current.nutrition?.sugar_g_100g ?? current.nutrition?.added_sugar_g_100g;
  const grid = layout === "grid";

  return (
    <section
      className={cn(
        "rounded-xl border border-(--color-line) bg-(--color-bg-soft)",
        compact ? "p-5" : "rounded-2xl p-6",
      )}
    >
      <h2
        className={cn(
          "font-display text-(--color-fg)",
          compact ? "text-xl" : "text-2xl",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "leading-relaxed text-(--color-fg-muted)",
          compact ? "mt-1 text-xs line-clamp-2" : "mt-2 text-sm",
        )}
      >
        {description ? (
          description
        ) : curSugar != null ? (
          <>
            Lower sugar & better macros in{" "}
            <strong className="text-(--color-fg)">{current.subcategory ?? "this aisle"}</strong>
            {current.brand ? (
              <>
                {" "}
                — not just more <span className="text-(--color-fg)">{current.brand}</span>
              </>
            ) : null}
            .
          </>
        ) : (
          <>Alternatives with better nutrition or Core score — varied brands.</>
        )}
      </p>

      <ul
        className={cn(
          grid
            ? gridColumns === 4
              ? "mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"
              : "mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"
            : compact
              ? "mt-4 space-y-3"
              : "mt-5 space-y-3",
        )}
      >
        {suggestions.map(({ product, goalFit, deltas }) => {
          const primaryDelta = deltas[0] ?? "Better match";
          const secondaryDeltas = deltas.slice(1, 3);

          return (
            <li key={product.id}>
              <Link
                href={productHref(product.slug, shoppingContext)}
                className={cn(
                  "u-lift flex gap-2 rounded-lg border border-(--color-line) bg-(--color-panel) hover:border-(--color-accent)",
                  grid
                    ? "h-full flex-col rounded-xl p-2.5"
                    : compact
                      ? "gap-3 p-3"
                      : "gap-3 rounded-xl p-3",
                )}
              >
                <div
                  className={cn(
                    "shrink-0",
                    grid ? "flex items-center justify-between gap-2" : "flex flex-col items-center gap-1",
                  )}
                >
                  {goal !== "balanced" ? (
                    <GoalFitBadge fit={goalFit} size="sm" />
                  ) : product.core_scores ? (
                    <ScoreBadge
                      score={product.core_scores.score}
                      grade={product.core_scores.grade}
                      className={grid ? "!h-10 !min-w-10 !rounded-lg !text-xl" : "!text-3xl"}
                    />
                  ) : (
                    <GoalFitBadge fit={goalFit} size="sm" />
                  )}
                  {grid && product.price_inr != null ? (
                    <span className="text-[11px] font-semibold tabular-nums text-(--color-fg-muted)">
                      ₹{product.price_inr}
                    </span>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-lg border border-(--color-line) bg-(--color-bg)",
                    grid
                      ? gridColumns === 4
                        ? "h-28 w-full xl:h-32"
                        : "h-24 w-full xl:h-28"
                      : compact
                        ? "h-16 w-16"
                        : "h-16 w-16",
                  )}
                >
                  {product.image_urls[0] ? (
                    <Image
                      src={product.image_urls[0]}
                      alt=""
                      fill
                      className={cn("object-contain", grid ? "p-1.5" : "p-1")}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  {product.brand ? (
                    <p className="text-[10px] uppercase tracking-wider text-(--color-fg-dim)">
                      {product.brand}
                    </p>
                  ) : null}
                  <p
                    className={cn(
                      "font-medium leading-snug text-(--color-fg)",
                      grid ? "line-clamp-2 text-[13px]" : "line-clamp-2 text-[13.5px]",
                    )}
                  >
                    {product.name}
                  </p>
                  <p className="mt-1 inline-flex max-w-full rounded-md bg-(--color-bg-soft) px-1.5 py-0.5 text-[10.5px] font-semibold leading-snug text-(--color-fg)">
                    {primaryDelta}
                  </p>
                  {secondaryDeltas.length > 0 ? (
                    <p className={cn("mt-0.5 leading-snug text-(--color-fg-dim)", grid ? "text-[10.5px]" : "text-[11px]")}>
                      {secondaryDeltas.join(" · ")}
                    </p>
                  ) : null}
                </div>
                {!grid && product.price_inr != null ? (
                  <div className="shrink-0 self-end">
                    <span className="text-[11px] font-semibold tabular-nums text-(--color-fg-muted)">
                      ₹{product.price_inr}
                    </span>
                  </div>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
