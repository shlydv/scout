import Image from "next/image";
import Link from "@/components/navigation-link";
import { LineTag } from "@/components/line-tag";
import type { LabelConflict } from "@/lib/insights/data";

/** Pack text arrives as printed ("TRANS FAT FREE", "zero palm oil"); show it in sentence case. */
function sentenceCase(t: string): string {
  const s = t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase() : t;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Claims / Reality" callout for one verified contradiction between the pack and its own label. */
export function ConflictCard({ c }: { c: LabelConflict }) {
  return (
    <Link href={`/product/${c.slug}`} className="u-lift group block rounded-xl border border-(--color-bad)/20 bg-(--color-panel) p-3 hover:border-(--color-bad)/45">
      <div className="flex items-start gap-2.5">
        <div className="thumb relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
          {c.image && <Image src={c.image} alt="" fill sizes="40px" className="object-contain p-0.5" />}
        </div>
        <div className="min-w-0 flex-1">
          {c.brand && <p className="truncate text-[9.5px] uppercase tracking-wide text-(--color-fg-dim)">{c.brand}</p>}
          <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-(--color-fg) group-hover:text-(--color-accent)">{c.name}</p>
        </div>
      </div>
      <div className="mt-2.5 space-y-1 text-[11.5px] leading-snug">
        <p className="flex items-baseline gap-1.5"><LineTag tone="good">Claims</LineTag><span className="text-(--color-fg)">“{sentenceCase(c.claim)}”</span></p>
        <p className="flex items-baseline gap-1.5"><LineTag tone="bad">Reality</LineTag><span className="text-(--color-fg-muted)">{sentenceCase(c.reality)}</span></p>
      </div>
    </Link>
  );
}
