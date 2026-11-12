import type { Metadata } from "next";
import Link from "@/components/navigation-link";
import { ArrowUpRight } from "lucide-react";
import { HomeRailCard } from "@/components/home-rail-card";
import { HomeBoards } from "@/components/home-boards";
import { RingGlyph } from "@/components/ring-motif";
import { ShelfBoard } from "@/components/shelf-board";
import { CountUp, Reveal } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SearchView } from "@/components/search/search-view";
import { SEARCH_PROMPTS } from "@/components/search-prompts";
import { getCachedLandingInsights } from "@/lib/products/catalog-cache";
import { getInsights, type InsightsData } from "@/lib/insights/data";
import type { LandingInsights } from "@/lib/products/landing-insights";
import { getHomeShelves } from "@/lib/products/queries";
import { collapseVariants } from "@/lib/products/variants";
import { SHELVES } from "@/lib/shelves";
import { getShelfWithin } from "@/lib/shelves-data";
import type { SearchResponse } from "@/lib/search/planned/present";

export const revalidate = 600;
export const maxDuration = 60;
// Shelves come from their daily cache. On a cold cache (after a deploy) wait as long as a
// shelf search may take (its 40 s deadline), so home gets what /shelves gets; a search stuck
// past that is cut off in lib/shelves-data and shows as "Being restocked".
const SHELF_WAIT_MS = 45_000;
// Searches are /?q= on this page; they all point Google at the bare home page.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const shelves = await getHomeShelves();
  const staples = await collapseVariants(shelves.dailyStaples);
  // Loaded apart, so one source failing doesn't empty the other's sections. Shelves never throw.
  const [landing, facts, goalShelves] = await Promise.all([
    getCachedLandingInsights().catch((err) => { console.warn("[home] landing insights skipped:", err); return null; }),
    getInsights().catch((err) => { console.warn("[home] label facts skipped:", err); return null; }),
    Promise.all(SHELVES.map(s => getShelfWithin(s.slug, SHELF_WAIT_MS))),
  ]);
  // One proof fact, told big: the share of packs with added sugar.
  const proof = facts?.ingredientStats.find(st => st.concept === "added_sugar") ?? facts?.ingredientStats[0] ?? null;

  // Example asks start on a different phrase each day.
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const promptStart = dayIndex % SEARCH_PROMPTS.length;
  const examples = [0, 1, 2].map((i) => SEARCH_PROMPTS[(promptStart + i) % SEARCH_PROMPTS.length]!);

  return (
    <main className="relative min-h-screen">
      <SiteNav />
      <div aria-hidden className="home-hero-art pointer-events-none absolute inset-x-0 top-0 h-svh overflow-hidden">
        <HeroBackdrop />
      </div>

      {/* ── Hero: one headline; the box below it is the site's search box ──── */}
      <div className="home-hero-copy relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center justify-end px-6 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-(--color-fg-dim)">
          Honest grocery intel · India
        </p>
        <h1 className="font-display mt-6 text-balance text-5xl leading-[0.97] md:text-7xl">
          We read the back label{" "}
          <span className="italic text-(--color-accent)">so you don&apos;t have to</span>.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-(--color-fg-muted)">
          Ask Scout what&apos;s actually in your basket — what&apos;s worth it,
          and what to skip.
        </p>
      </div>

      <SearchView
        examples={examples}
        heroFoot={shelves.totalScored > 0 && (
          <p className="mt-9 text-[12px] tracking-wide text-(--color-fg-dim)">
            <span className="font-medium text-(--color-fg-muted) tabular-nums">
              <CountUp value={shelves.totalScored} />
            </span>{" "}
            <Link href="/catalog" className="underline-offset-4 transition hover:text-(--color-fg) hover:underline">
              products scored across India&apos;s quick-commerce shelves
            </Link>
          </p>
        )}
        footer={<SiteFooter />}
        landing={<HomeSections landing={landing} facts={facts} goalShelves={goalShelves} proof={proof} staples={staples} />}
      />
    </main>
  );
}


/** Everything under the search box while nothing is searched: the leaderboards, then the shelves. */
function HomeSections({ landing, facts, goalShelves, proof, staples }: {
  landing: LandingInsights | null;
  facts: InsightsData | null;
  goalShelves: (SearchResponse | null)[];
  proof: InsightsData["ingredientStats"][number] | null;
  staples: Awaited<ReturnType<typeof getHomeShelves>>["dailyStaples"];
}) {
  return (
    <>
      <HomeBoards landing={landing} insights={facts} />

      {/* ── Start from a goal: every shelf's top three, as on /shelves ───── */}
      <section className="border-y border-(--color-line)">
        <Reveal className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-(--color-accent)">Goal shelves</p>
              <h2 className="font-display mt-3 text-3xl leading-tight md:text-[2.5rem]">Twelve shelves, <span className="italic">kept honest.</span></h2>
            </div>
            <Link href="/shelves" className="inline-flex items-center gap-1.5 text-sm font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)">
              All shelves <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SHELVES.map((s, i) => (
              <ShelfBoard key={s.slug} shelf={s} index={i} items={goalShelves[i]?.items ?? []} total={goalShelves[i]?.items.length ?? 0} />
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── One proof, told with confidence: a number inside the score ring ── */}
      {proof && (
        <section className="relative overflow-hidden border-b border-(--color-line) bg-(--color-bg-soft)">
          <RingGlyph className="absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-[58%] opacity-60 md:h-[440px] md:w-[440px]" />
          <Reveal className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center md:py-28">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-(--color-fg-dim)">What we found</p>
            <p className="font-display mt-5 text-7xl leading-none text-(--color-accent) md:text-8xl">{proof.pct}%</p>
            <p className="font-display mt-5 max-w-2xl text-balance text-2xl leading-snug text-(--color-fg) md:text-[1.9rem]">
              of the packaged foods we&apos;ve read {proof.label}.
            </p>
            <Link href="/insights" className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-(--color-fg-muted) underline-offset-4 transition hover:text-(--color-fg) hover:underline">
              What else is in there <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Reveal>
        </section>
      )}

      {/* ── The light after the shade: what Scout actually loves ──────────── */}
      <Rail
        eyebrow="What Scout loves"
        title="Worth buying every week."
        subtitle="Whole foods or close to it — top scores, no concern flags."
        cta={{ href: "/catalog?verdict=daily_staple", label: "All staples" }}
        items={staples}
      />

    </>
  );
}

function Rail({
  eyebrow,
  title,
  subtitle,
  cta,
  items,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  cta?: { href: string; label: string };
  items: Awaited<ReturnType<typeof getHomeShelves>>["dailyStaples"];
}) {
  if (!items.length) return null;
  return (
    <section>
      <Reveal className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-(--color-fg-dim)">
              {eyebrow}
            </p>
            <h2 className="font-display mt-3 text-3xl leading-tight md:text-[2.5rem]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-(--color-fg-muted)">
                {subtitle}
              </p>
            )}
          </div>
          {cta && (
            <Link
              href={cta.href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)"
            >
              {cta.label}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.slice(0, 10).map((p) => (
            <HomeRailCard key={p.id} product={p} />
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/**
 * Hero backdrop — fills the wide side-gutters (especially in dark mode) with the
 * score-ring motif that recurs across cards/PDP, plus a soft warm glow. Anchored
 * mostly off-screen, very low opacity, hidden on mobile (no gutters there). Pure
 * decoration: aria-hidden, pointer-events-none — calm, never distracting.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* warm centre glow — depth behind the headline */}
      <div
        className="absolute left-1/2 top-[42%] h-[52vh] w-[52vh] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent)",
        }}
      />
      {/* left gutter ring */}
      <svg
        className="absolute -left-40 top-[18%] hidden h-[360px] w-[360px] text-(--color-line-strong) opacity-70 lg:block"
        viewBox="0 0 100 100"
        fill="none"
      >
        <circle cx="50" cy="50" r="47" stroke="currentColor" strokeWidth="0.4" />
        <circle cx="50" cy="50" r="33" stroke="currentColor" strokeWidth="0.4" />
        <path
          d="M50 3 a47 47 0 0 1 41 24"
          stroke="var(--color-accent)"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.3"
        />
      </svg>
      {/* right gutter ring, larger + lower */}
      <svg
        className="absolute -right-48 bottom-[12%] hidden h-[460px] w-[460px] text-(--color-line-strong) opacity-70 lg:block"
        viewBox="0 0 100 100"
        fill="none"
      >
        <circle cx="50" cy="50" r="47" stroke="currentColor" strokeWidth="0.4" />
        <circle cx="50" cy="50" r="33" stroke="currentColor" strokeWidth="0.4" />
        <path
          d="M50 97 a47 47 0 0 1 -41 -24"
          stroke="var(--color-accent)"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.25"
        />
      </svg>
    </div>
  );
}
