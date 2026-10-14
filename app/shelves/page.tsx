import type { Metadata } from "next";
import { PaperBackdrop } from "@/components/paper-backdrop";
import { Reveal } from "@/components/reveal";
import { ShelfBoard } from "@/components/shelf-board";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SHELVES } from "@/lib/shelves";
import { getShelf } from "@/lib/shelves-data";

// Each shelf's results are cached for a day (lib/shelves-data); the page itself
// re-renders hourly so a shelf that failed once doesn't stay empty all day.
export const revalidate = 3600;
export const preferredRegion = "sin1";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Goal shelves · Scout",
  description: "Twelve shortlists we keep stocked — high-protein snacks, kids' tiffin, diabetic-friendly breakfast — each re-checked against the back label every day.",
};

export default async function ShelvesPage() {
  const results = await Promise.all(SHELVES.map(s => getShelf(s.slug)));
  const refreshed = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

  return (
    <main className="relative isolate min-h-screen">
      <PaperBackdrop />
      <SiteNav />
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 md:px-6 md:pt-14">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--color-fg-dim)">Goal shelves · restocked {refreshed}</p>
        <h1 className="font-display mt-2 max-w-3xl text-4xl leading-[1.05] text-(--color-fg) md:text-[3.25rem]">
          Twelve shelves, <span className="italic text-(--color-accent)">kept honest.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-(--color-fg-muted)">
          Pick what you&apos;re shopping for and start from the shortlist. Every pick is read off the back label, and the list is re-checked every day.
        </p>
        <Reveal className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SHELVES.map((s, i) => (
            <ShelfBoard key={s.slug} shelf={s} index={i} items={results[i]?.items ?? []} total={results[i]?.items.length ?? 0} />
          ))}
        </Reveal>
      </div>
      <SiteFooter />
    </main>
  );
}
