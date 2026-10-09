import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { HomeRailCard } from "@/components/home-rail-card";
import { HomeCategoryGrid } from "@/components/home-editorial";
import { ConflictCard } from "@/components/insights/conflict-card";
import { CountUp, Reveal } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SEARCH_PROMPTS } from "@/components/search-prompts";
import { getCachedLandingInsights } from "@/lib/products/catalog-cache";
import { getInsights, type InsightsData } from "@/lib/insights/data";
import { EMPTY_LANDING_INSIGHTS, type LandingInsights } from "@/lib/products/landing-insights";
import { getHomeShelves } from "@/lib/products/queries";
import { collapseVariants } from "@/lib/products/variants";
import { SHELVES } from "@/lib/shelves";

export const revalidate = 600;

export default async function Home() {
  const shelves = await getHomeShelves();
  const staples = await collapseVariants(shelves.dailyStaples);
  let insights: LandingInsights = EMPTY_LANDING_INSIGHTS;
  let facts: InsightsData | null = null;
  try {
    [insights, facts] = await Promise.all([getCachedLandingInsights(), getInsights()]);
  } catch (err) {
    console.warn("[home] insights skipped:", err);
  }
  const oneIn = facts?.conflictedProducts ? Math.round(facts.claimers / facts.conflictedProducts) : 0;

  // Typewriter starts on a different phrase each day.
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const promptStart = dayIndex % SEARCH_PROMPTS.length;
  const examples = [0, 1, 2].map((i) => SEARCH_PROMPTS[(promptStart + i) % SEARCH_PROMPTS.length]!);


  return (
    <main className="min-h-screen">
      <SiteNav />

      {/* ── Hero — one headline, one action, room to breathe ─────────────── */}
      {/* min-h fills the first fold so the next section's tint never peeks up
          into the hero on tall screens; content sits optically centered. */}
      <section className="relative flex min-h-[88vh] items-center overflow-hidden border-b border-(--color-line)">
        <HeroBackdrop />
        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-6 pb-20 pt-12 text-center md:pb-24 md:pt-16">
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

          {/* The one action */}
          <form
            action="/search"
            method="get"
            className="mt-9 flex w-full max-w-xl items-center gap-2 rounded-2xl border border-(--color-line-strong) bg-(--color-panel) p-2 shadow-sm transition focus-within:border-(--color-fg-muted) focus-within:shadow-md focus-within:ring-4 focus-within:ring-(--color-accent)/10"
          >
            <input
              name="q"
              required
              minLength={2}
              type="search"
              autoComplete="off"
              placeholder="Search a snack, or describe what you want…"
              aria-label="Ask Scout about any packaged food"
              className="min-h-11 flex-1 bg-transparent px-3 text-[15px] text-(--color-fg) outline-none placeholder:text-(--color-fg-dim)"
            />
            <button
              type="submit"
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-(--color-fg) px-4 text-sm font-semibold text-(--color-bg) transition hover:opacity-90 sm:px-5"
            >
              Ask Scout
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Quiet example asks */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-[13px] text-(--color-fg-dim)">
            <span className="text-(--color-fg-dim)/70">Try</span>
            {examples.map((ex, i) => (
              <span key={ex} className="flex items-center gap-2">
                {i > 0 && <span className="text-(--color-fg-dim)/40">·</span>}
                <Link
                  href={`/search?q=${encodeURIComponent(ex)}`}
                  className="text-(--color-fg-muted) underline-offset-4 transition hover:text-(--color-fg) hover:underline"
                >
                  {ex}
                </Link>
              </span>
            ))}
          </div>

          {shelves.totalScored > 0 && (
            <p className="mt-10 text-[12px] tracking-wide text-(--color-fg-dim)">
              <span className="font-medium text-(--color-fg-muted) tabular-nums">
                <CountUp value={shelves.totalScored} />
              </span>{" "}
              <Link href="/catalog" className="underline-offset-4 transition hover:text-(--color-fg) hover:underline">
                products scored across India&apos;s quick-commerce shelves
              </Link>
            </p>
          )}
        </div>
      </section>

      {/* ── Start from a goal ──────────────────────────────────────────── */}
      <section className="border-b border-(--color-line)">
        <Reveal className="mx-auto max-w-7xl px-6 py-14 md:py-20">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-(--color-fg-dim)">Start from a goal</p>
              <h2 className="font-display mt-3 text-3xl leading-tight md:text-[2.5rem]">Shortlists, checked against the label.</h2>
            </div>
            <Link href="/shelves" className="inline-flex items-center gap-1.5 text-sm font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)">
              All shelves <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {SHELVES.slice(0, 6).map(s => (
              <Link key={s.slug} href={`/shelves/${s.slug}`} className="u-lift rounded-2xl border border-(--color-line) bg-(--color-panel) p-4 hover:border-(--color-fg-muted)">
                <span className="text-2xl" aria-hidden>{s.emoji}</span>
                <span className="mt-2 block text-[15px] font-medium leading-snug text-(--color-fg)">{s.title}</span>
              </Link>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── The hook: what the pack says vs what the label says ─────────── */}
      {facts && facts.conflicts.length >= 3 && (
        <section className="border-b border-(--color-line) bg-(--color-bg-soft)">
          <Reveal className="mx-auto max-w-7xl px-6 py-16 md:py-24">
            <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-(--color-fg-dim)">Front of pack vs back of pack</p>
                <h2 className="font-display mt-3 text-3xl leading-tight md:text-[2.5rem]">
                  {oneIn ? `1 in ${oneIn} “free-from” claims doesn’t survive the ingredient list.` : "Claims that don't survive the ingredient list."}
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-(--color-fg-muted)">
                  Sugar-free packs that list sugar. “No palm oil” chips fried in palmolein. Every one checked twice against the printed label.
                </p>
              </div>
              <Link href="/insights/claims" className="inline-flex items-center gap-1.5 text-sm font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)">
                See all {facts.conflictedProducts} <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {facts.conflicts.slice(0, 6).map(c => <ConflictCard key={`${c.id}-${c.claim}`} c={c} />)}
            </div>
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

      {/* ── Explore: every aisle, judged ──────────────────────────────────── */}
      {insights.bestInClass.length > 0 && <HomeCategoryGrid categories={insights.bestInClass} />}

      <SiteFooter />
    </main>
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
      <Reveal className="mx-auto max-w-7xl px-6 py-16 md:py-24">
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
