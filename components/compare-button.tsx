"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Check } from "lucide-react";
import {
  COMPARE_EVENT,
  isInCompare,
  toggleCompare,
} from "@/lib/compare/storage";
import { cn } from "@/lib/utils";

/** Toggle a product in the compare tray. Icon-only on cards, labelled on PDP. */
export function CompareButton({
  slug,
  name,
  image,
  shoppingContext,
  size = "icon",
  className,
}: {
  slug: string;
  name: string;
  image: string | null;
  shoppingContext?: string;
  size?: "icon" | "labelled";
  className?: string;
}) {
  const [active, setActive] = useState(false);
  const [bounced, setBounced] = useState(false);

  useEffect(() => {
    const sync = () => setActive(isInCompare(slug));
    sync();
    window.addEventListener(COMPARE_EVENT, sync);
    return () => window.removeEventListener(COMPARE_EVENT, sync);
  }, [slug]);

  const onToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = toggleCompare({ slug, name, image, shoppingContext });
    if (!ok) {
      // Tray is full — nudge instead of failing silently.
      setBounced(true);
      window.setTimeout(() => setBounced(false), 1200);
    }
  };

  if (size === "labelled") {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition",
          active
            ? "border-(--color-fg) bg-(--color-fg) text-(--color-bg)"
            : "border-(--color-line) bg-(--color-panel) text-(--color-fg) hover:border-(--color-fg-muted)",
          className,
        )}
      >
        {active ? <Check className="h-3.5 w-3.5" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
        {bounced ? "Tray full (4 max)" : active ? "In compare" : "Compare"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? `Remove ${name} from compare` : `Compare ${name}`}
      title={bounced ? "Compare tray is full (4 max)" : active ? "Remove from compare" : "Add to compare"}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full border transition",
        active
          ? "border-(--color-fg) bg-(--color-fg) text-(--color-bg)"
          : "border-(--color-line) bg-(--color-panel) text-(--color-fg-muted) hover:border-(--color-fg-muted) hover:text-(--color-fg)",
        bounced && "animate-pulse",
        className,
      )}
    >
      {active ? <Check className="h-3.5 w-3.5" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
    </button>
  );
}
