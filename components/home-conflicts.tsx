"use client";

import { useEffect, useState } from "react";
import { ConflictCard } from "@/components/insights/conflict-card";
import type { LabelConflict } from "@/lib/insights/data";
import { sampleConflicts } from "@/lib/insights/sample-conflicts";

/**
 * The home page's "marketing's a lie" cards: a new random set on every visit, even within one
 * session. The server render shows the pool's first cards; the pick replaces them on mount,
 * while the section is still below the fold.
 */
export function HomeConflicts({ pool, count }: { pool: LabelConflict[]; count: number }) {
  const [shown, setShown] = useState(() => pool.slice(0, count));
  useEffect(() => setShown(sampleConflicts(pool, count)), [pool, count]);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map(c => <ConflictCard key={`${c.id}-${c.claim}`} c={c} />)}
    </div>
  );
}
