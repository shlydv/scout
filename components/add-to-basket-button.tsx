"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { addToBasket, decrementBasket, readBasket } from "@/lib/basket/storage";
import { cn } from "@/lib/utils";

export function AddToBasketButton({
  slug,
  name,
  productId,
  className,
  size = "default",
}: {
  slug: string;
  name: string;
  productId?: string;
  className?: string;
  /** `icon` — compact overlay for catalog cards */
  size?: "default" | "icon";
}) {
  const [qty, setQty] = useState(0);

  useEffect(() => {
    const sync = () => {
      const e = readBasket().find((x) => x.slug === slug);
      setQty(e?.qty ?? 0);
    };
    sync();
    window.addEventListener("scout-basket", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("scout-basket", sync);
      window.removeEventListener("storage", sync);
    };
  }, [slug]);

  if (size === "icon") {
    return (
      <div
        className={cn("flex shrink-0 items-center gap-1", className)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {qty > 0 ? (
          <>
            <button
              type="button"
              aria-label="Remove one"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                decrementBasket(slug);
              }}
              className="grid h-8 w-8 place-items-center rounded-full bg-(--color-fg) text-(--color-bg) transition hover:opacity-90 active:scale-90"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span
              key={qty}
              className="count-pop min-w-[1.25rem] text-center text-xs font-semibold tabular-nums text-(--color-fg)"
            >
              {qty}
            </span>
          </>
        ) : null}
        <button
          type="button"
          aria-label={qty > 0 ? "Add another" : "Add to basket"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            addToBasket(slug, name);
          }}
          className="grid h-8 w-8 place-items-center rounded-full bg-(--color-fg) text-(--color-bg) shadow-sm transition hover:opacity-90 active:scale-90"
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        addToBasket(slug, name);
      }}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg border border-(--color-line) bg-(--color-panel) px-3 py-2 text-sm font-medium text-(--color-fg) transition hover:border-(--color-fg) active:scale-[0.97]"
      }
    >
      <Plus className="h-4 w-4" />
      {qty > 0 ? `In basket (${qty})` : "Add to basket"}
    </button>
  );
}
