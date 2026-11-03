"use client";

import Image from "next/image";
import Link from "@/components/navigation-link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import {
  COMPARE_EVENT,
  clearCompare,
  readCompare,
  removeFromCompare,
  type CompareEntry,
} from "@/lib/compare/storage";

/** Floating bottom tray — appears once anything is queued for comparison. */
export function CompareTray() {
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    const sync = () => setEntries(readCompare());
    sync();
    window.addEventListener(COMPARE_EVENT, sync);
    return () => window.removeEventListener(COMPARE_EVENT, sync);
  }, []);

  // The /compare page renders its own management UI.
  if (!entries.length || pathname === "/compare") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-(--color-line-strong) bg-(--color-panel) py-2.5 pl-3 pr-2.5 shadow-xl">
        <div className="flex items-center gap-1.5">
          {entries.map((e) => (
            <div
              key={e.slug}
              className="group relative h-11 w-11 overflow-hidden rounded-lg border border-(--color-line) bg-(--color-bg-soft)"
              title={e.name}
            >
              {e.image ? (
                <Image src={e.image} alt={e.name} fill sizes="44px" className="object-contain p-0.5" />
              ) : (
                <span className="grid h-full w-full place-items-center text-[9px] text-(--color-fg-dim)">
                  {e.name.slice(0, 2)}
                </span>
              )}
              <button
                type="button"
                onClick={() => removeFromCompare(e.slug)}
                aria-label={`Remove ${e.name} from compare`}
                className="absolute inset-0 grid place-items-center bg-(--color-fg)/70 text-(--color-bg) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="min-w-0 flex-1 truncate text-[12px] text-(--color-fg-muted)">
          {entries.length === 1
            ? "Add one more to compare"
            : `${entries.length} products selected`}
        </p>
        <button
          type="button"
          onClick={clearCompare}
          className="shrink-0 text-[12px] text-(--color-fg-dim) underline-offset-4 hover:text-(--color-fg) hover:underline"
        >
          Clear
        </button>
        <Link
          href="/compare"
          aria-disabled={entries.length < 2}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            entries.length >= 2
              ? "bg-(--color-fg) text-(--color-bg) hover:opacity-90"
              : "pointer-events-none bg-(--color-bg-soft) text-(--color-fg-dim)"
          }`}
        >
          Compare
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
