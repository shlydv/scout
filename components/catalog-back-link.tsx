"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** PDP back link: returns to the search results the product was opened from, else history. */
export function CatalogBackLink({ params }: { params: { q?: string; prompt?: string } }) {
  const router = useRouter();
  const q = (params.q ?? params.prompt ?? "").trim();
  const href = q ? `/search?q=${encodeURIComponent(q)}` : "/catalog";
  return (
    <Link
      href={href}
      onClick={e => {
        // Prefer real history (keeps scroll position and filters) when we came from inside Scout.
        if (!q && typeof window !== "undefined" && document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className="text-sm text-(--color-fg-muted) hover:text-(--color-fg)"
    >
      ← {q ? `Results for “${q.length > 32 ? `${q.slice(0, 32)}…` : q}”` : "Back"}
    </Link>
  );
}
