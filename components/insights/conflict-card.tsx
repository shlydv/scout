import Image from "next/image";
import Link from "next/link";
import type { LabelConflict } from "@/lib/insights/data";

/** Pack text arrives as printed ("TRANS FAT FREE", "zero palm oil"); show it in sentence case. */
function sentenceCase(t: string): string {
  const s = t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase() : t;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "The pack says / the label says" callout for one verified contradiction. */
export function ConflictCard({ c }: { c: LabelConflict }) {
  return (
    <Link href={`/product/${c.slug}`} className="group flex flex-col overflow-hidden rounded-2xl border border-(--color-line) bg-(--color-panel) transition hover:border-(--color-line-strong)">
      <div className="flex items-center gap-3 p-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white">
          {c.image && <Image src={c.image} alt="" fill sizes="64px" className="object-contain p-1.5" />}
        </div>
        <div className="min-w-0">
          {c.brand && <p className="truncate text-[11px] font-medium uppercase tracking-wide text-(--color-fg-dim)">{c.brand}</p>}
          <p className="line-clamp-2 text-sm font-medium leading-snug text-(--color-fg) group-hover:underline">{c.name}</p>
        </div>
      </div>
      <dl className="mt-auto grid grid-cols-2 border-t border-(--color-line) text-[13px]">
        <div className="border-r border-(--color-line) p-3.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-(--color-fg-dim)">The pack says</dt>
          <dd className="mt-1 font-medium text-(--color-fg)">“{sentenceCase(c.claim)}”</dd>
        </div>
        <div className="p-3.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-(--color-bad)">The label says</dt>
          <dd className="mt-1 text-(--color-fg-muted)">{sentenceCase(c.reality)}</dd>
        </div>
      </dl>
    </Link>
  );
}
