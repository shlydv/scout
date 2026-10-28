import { productHref } from "@/lib/shopping/links";
import { resolveShoppingContext, filterShoppingCandidates } from "@/lib/shopping/recommendations";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IngredientPanel } from "@/components/ingredient-panel";
import { PdpNutritionGlance } from "@/components/pdp-nutrition-glance";
import { PdpMacroStrip } from "@/components/pdp-macro-strip";
import { PdpLabelInsights } from "@/components/pdp-label-insights";
import { PdpServingNote } from "@/components/pdp-serving-note";
import { reconcileNutrition } from "@/lib/nutrition/sanity";
import { ProductGallery } from "@/components/product-gallery";
import { ProductGoalFitList } from "@/components/product-goal-fit-list";
import { ProductGoalToolbar } from "@/components/product-goal-toolbar";
import { ScoutVerdictCard } from "@/components/scout-verdict-card";
import { VerdictTakeCard } from "@/components/verdict-take-card";
import { SwapPanel } from "@/components/swap-panel";
import { buildOverallGoalSummary, buildProductGoalRows } from "@/lib/goals/build-goal-rows";
import { goalFromParam } from "@/lib/goals/types";
import { dietFromParam } from "@/lib/diet/types";
import { productDietBadge } from "@/lib/diet/match";
import { DietBadgeRow } from "@/components/diet-badge";
import { explainScore } from "@/lib/products/score-explain";
import { explainLabelMismatch } from "@/lib/scoring/labels-score";
import { LabelMismatchCallout } from "@/components/label-mismatch-callout";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import { mergePdpSublabelIds } from "@/lib/scoring/sublabels";
import { CatalogBackLink } from "@/components/catalog-back-link";
import { variantInfo } from "@/lib/products/variants";
import { VERDICT_LABELS } from "@/lib/scoring/verdict";
import { Reveal } from "@/components/reveal";
import { reconcileDisplayIngredients } from "@/lib/ocr/deepseek-ingredients";
import {
  deepseekDisplayFromPayload,
  deepseekLabelFromPayload,
} from "@/lib/ocr/deepseek-promote";
import { loadIngredientIntelligenceForDisplay } from "@/lib/ingredients/load-intelligence";
import { resolveZeptoBuyUrl } from "@/lib/products/zepto-product-url";
import { findAlternatives, findSimilarProducts } from "@/lib/products/alternatives";
import { getProductBySlug, getProductsForSwaps } from "@/lib/products/queries";
import { displayPriceInr, showMrpStrike } from "@/lib/products/display-price";
import type { Metadata } from "next";
import Link from "next/link";
import type { SubScores } from "@/lib/supabase/types";
import { brandSlug } from "@/lib/brands/slug";

export const revalidate = 300;
export const maxDuration = 60;

/** Share cards carry the verdict — the score IS the story. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found · Scout" };

  const score = product.core_scores;
  const title = score
    ? `${product.name} — ${score.score}/100 · Scout`
    : `${product.name} · Scout`;
  const description =
    score?.opinion?.headline ??
    (score
      ? `Scout health score ${score.score}/100. We read the back label so you don't have to.`
      : "We read the back label so you don't have to.");
  // The share image comes from ./opengraph-image.tsx (score + verdict card);
  // setting images here would override it with the bare product photo.
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    prompt?: string;
    goal?: string;
    diet?: string;
    q?: string;
    context?: string;
    category?: string;
    subcategory?: string;
    usecase?: string;
    brand?: string;
    scored?: string;
    labelResolved?: string;
    deepseek?: string;
    min?: string;
    maxprice?: string;
    grade?: string;
    sort?: string;
    sublabel?: string;
    verdict?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { goal: goalParam, diet: dietParam } = sp;
  const goal = goalFromParam(goalParam);
  const diet = dietFromParam(dietParam);
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const price = displayPriceInr(product);
  const zeptoBuyUrl = resolveZeptoBuyUrl(product);

  const displayNutrition = reconcileNutrition({
    nutrition: product.nutrition,
    attributes: product.attributes,
    name: product.name,
    category: product.category,
    subcategory: product.subcategory,
    net_weight: product.net_weight,
  });
  const productForGoals = displayNutrition ? { ...product, nutrition: displayNutrition } : product;

  const displayIngredients = reconcileDisplayIngredients({
    ingredients_raw: product.ingredients_raw,
    ocr_payload: product.ocr_payload,
    productName: product.name,
  });

  // Both depend only on the product row — run in parallel, not back to back.
  const [swapPool, ingredientIntelligence] = await Promise.all([
    getProductsForSwaps(product, 180),
    loadIngredientIntelligenceForDisplay(displayIngredients),
  ]);

  // Pack sizes of this product are not "alternatives", and each other product
  // appears once rather than once per size.
  const variants = await variantInfo([product.id, ...swapPool.map((p) => p.id)]);
  const groupOf = (id: string) => variants.get(id)?.key ?? id;
  const ownGroup = groupOf(product.id);
  const seenGroups = new Set<string>([ownGroup]);
  const distinctPool = swapPool.filter((p) => {
    const g = groupOf(p.id);
    if (seenGroups.has(g)) return false;
    seenGroups.add(g);
    return true;
  });
  const otherSizes = (variants.get(product.id)?.sizes ?? []).filter((s) => s.slug !== product.slug);

  const shopping = await resolveShoppingContext(sp.context, sp.q);
  const checkedPool = await filterShoppingCandidates([product, ...distinctPool], shopping);
  const currentConfirmed = !shopping.active || checkedPool.some(p => p.id === product.id);
  const safePool = checkedPool.filter(p => p.id !== product.id);
  const swaps = findAlternatives(product, safePool, goal, 8, { diet });
  const similarProducts = findSimilarProducts(product, safePool, goal, 8, {
    diet,
    excludeIds: new Set(swaps.map((s) => s.product.id)),
  });
  const goalRows = buildProductGoalRows(productForGoals);
  const overallGoal = buildOverallGoalSummary(productForGoals);
  const dietBadge = productDietBadge(product);

  const score = product.core_scores;
  const subscores = score?.subscores as SubScores | undefined;
  const deepseekLabel = deepseekLabelFromPayload(product.ocr_payload);
  const deepseekDisplay = deepseekDisplayFromPayload(product.ocr_payload);
  const verdict = score
    ? resolveProductVerdict({
        verdict: score.verdict,
        score: score.absolute_score ?? score.score,
        name: product.name,
        category: product.category,
        subcategory: product.subcategory,
        hazardous: Boolean(
          (score.breakdown as { hard_capped?: boolean } | null)?.hard_capped,
        ),
      })
    : null;

  const scoreWhy = score
    ? explainScore({
        score: score.score,
        band: score.band,
        subscores,
        concerns: score.concerns,
        breakdown: score.breakdown,
        nutrition: product.nutrition,
        ingredients_raw: displayIngredients,
        productName: product.name,
        category: product.category,
        subcategory: product.subcategory,
        role_cohort: score.role_cohort,
      })
    : null;

  const pdpSublabels = score
    ? mergePdpSublabelIds(score.verdict_sublabels, score.breakdown, 8)
    : [];

  // Scout's signature catch: the front-of-pack claim contradicts the panel.
  const labelMismatch = explainLabelMismatch(
    displayIngredients,
    product.attributes ?? null,
    displayNutrition ?? product.nutrition,
  );

  // Product rich-result schema for Google (no fake ratings — name/brand/price only).
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(product.image_urls?.length ? { image: product.image_urls.slice(0, 3) } : {}),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
    ...(siteUrl ? { url: `${siteUrl}/product/${product.slug}` } : {}),
    ...(price != null
      ? { offers: { "@type": "Offer", priceCurrency: "INR", price: String(price) } }
      : {}),
  };

  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteNav />

      <div className="mx-auto max-w-7xl px-6 pb-24 pt-6">
        <CatalogBackLink params={sp} />

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16 lg:items-start">
          {/* Left: product imagery (whitespace below reads as intentional) */}
          <div className="space-y-5">
            <ProductGallery images={product.image_urls} alt={product.name} />
          </div>

          {/* Right: the full Scout analysis stack — verdict, macros, goals */}
          <div className="min-w-0">
            {product.brand ? (
              <Link href={`/brands/${brandSlug(product.brand)}`} className="text-[11px] font-medium uppercase tracking-[0.2em] text-(--color-fg-dim) hover:text-(--color-fg)">
                {product.brand} <span aria-hidden>→</span>
              </Link>
            ) : null}
            <h1 className="font-display mt-2 text-balance text-3xl leading-[1.05] md:text-[2.5rem]">
              {product.name}
            </h1>
            <p className="mt-2 text-sm text-(--color-fg-muted)">
              {[product.category, product.subcategory, product.l3_category]
                .filter(Boolean)
                .join(" · ")}
              {product.net_weight ? ` · ${product.net_weight}` : ""}
            </p>
            <DietBadgeRow badge={dietBadge} selected={diet} />
            {!shopping.active && otherSizes.length > 0 ? (
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-(--color-fg-muted)">
                <span>Also in</span>
                {otherSizes.map((s) => (
                  <Link key={s.slug} href={productHref(s.slug, shopping.token ?? (shopping.active ? "unavailable" : undefined), sp.q)} className="rounded-full border border-(--color-line) px-2.5 py-0.5 hover:border-(--color-fg-muted) hover:text-(--color-fg)">
                    {s.net_weight ?? "other size"}{s.price_inr != null ? ` · ₹${s.price_inr}` : ""}
                  </Link>
                ))}
              </p>
            ) : null}
            {price != null ? (
              <p className="mt-4 text-2xl font-semibold tabular-nums">
                ₹{price}
                {showMrpStrike(product) ? (
                  <span className="ml-2 text-base font-normal text-(--color-fg-dim) line-through">
                    ₹{product.mrp_inr}
                  </span>
                ) : null}
              </p>
            ) : null}
            {shopping.active && <p role="status" className="mt-4 text-sm text-(--color-fg-muted)">{currentConfirmed ? "Checked against your search requirements." : "This product could not be confirmed for your search requirements. Check the label before choosing it."}</p>}
            <ProductGoalToolbar
              shoppingContext={shopping.token ?? (shopping.active ? "unavailable" : undefined)}
              slug={product.slug}
              name={product.name}
              image={product.image_urls?.[0] ?? null}
              zeptoBuyUrl={zeptoBuyUrl}
              shareText={
                score?.score != null
                  ? `Is ${product.name} actually healthy? Scout scores it ${score.absolute_score ?? score.score}/100${verdict ? ` (${VERDICT_LABELS[verdict].title.toLowerCase()})` : ""}${score.opinion?.headline ? ` — ${score.opinion.headline}` : ""}.`
                  : `${product.name} — read by Scout`
              }
            />

            {verdict && score?.opinion ? (
              <div className="mt-5">
                <ScoutVerdictCard
                  score={score?.score}
                  absoluteScore={score?.absolute_score}
                  categoryRank={score?.category_rank}
                  categorySize={score?.category_size}
                  categoryLabel={score?.category_label}
                  opinion={score.opinion}
                />
              </div>
            ) : verdict ? (
              <div className="mt-5">
                <VerdictTakeCard
                  verdict={verdict}
                  score={score?.score}
                  absoluteScore={score?.absolute_score}
                  categoryRank={score?.category_rank}
                  categorySize={score?.category_size}
                  categoryLabel={score?.category_label}
                  sublabelIds={pdpSublabels}
                  deepseekChips={deepseekDisplay?.chips}
                  deepseekWhy={deepseekDisplay?.why}
                  explanation={scoreWhy}
                />
              </div>
            ) : null}

            {/* The four numbers people want, big and instant — right under the
                verdict so they're never buried in the collapsed label. */}
            <div className="mt-4">
              <PdpMacroStrip
                nutrition={displayNutrition ?? product.nutrition}
                netWeight={product.net_weight}
                roleCohort={score?.role_cohort}
              />
            </div>

            {/* Per-goal fit — completes the analysis stack and fills the column
                so the two top columns end roughly even (no jagged right gap). */}
            <Suspense fallback={null}>
              <ProductGoalFitList
                rows={goalRows}
                overall={overallGoal}
                className="mt-5"
                cardClassName="text-sm"
              />
            </Suspense>

            {labelMismatch ? (
              <div className="mt-3">
                <LabelMismatchCallout detail={labelMismatch} />
              </div>
            ) : null}
          </div>
        </div>

        <Reveal className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-start">
          <section className="min-w-0">
            <h2 className="font-display text-2xl">Ingredients</h2>
            <p className="mt-1.5 text-[13px] text-(--color-fg-muted)">
              Tap any flagged ingredient for the why behind it.
            </p>
            <div className="mt-5">
              <IngredientPanel
                ingredientsRaw={displayIngredients}
                intelligenceRows={ingredientIntelligence}
              />
            </div>
          </section>

          <aside className="min-w-0 space-y-5">
            <PdpServingNote
              roleCohort={score?.role_cohort}
              servingG={score?.serving_g_effective}
              nutrition={displayNutrition ?? product.nutrition}
            />
            {displayNutrition ? (
              <PdpNutritionGlance
                nutrition={displayNutrition}
                netWeight={product.net_weight}
                priceInr={price}
                name={product.name}
                category={product.category}
                subcategory={product.subcategory}
                roleCohort={score?.role_cohort}
              />
            ) : null}
            <PdpLabelInsights deepseek={deepseekLabel} />
          </aside>
        </Reveal>

        {shopping.active && (shopping.blocked || (!swaps.length && !similarProducts.length)) ? (
          <p role="status" className="mt-8 text-sm text-(--color-fg-muted)">No alternatives could be confirmed for your search requirements. Search again to refresh these checks.</p>
        ) : shopping.active ? (
          <p className="mt-8 text-sm text-(--color-fg-muted)">Alternatives checked against your search requirements.</p>
        ) : null}

        {/* Better alternatives — full-width, below the deep-dive, above discovery.
            Action ("swap to something stronger") outranks browse, so it leads. */}
        {swaps.length > 0 ? (
          <Reveal className="mt-12">
            <SwapPanel
              shoppingContext={shopping.token}
              current={product}
              suggestions={swaps}
              compact
              goal={goal}
              title="Better alternatives"
              description="Similar products that look stronger on score, macros, or ingredients."
              layout="grid"
              gridColumns={4}
            />
          </Reveal>
        ) : null}

        {similarProducts.length > 0 ? (
          <Reveal className="mt-12">
            <SwapPanel
              shoppingContext={shopping.token}
              current={product}
              suggestions={similarProducts}
              compact
              goal={goal}
              title="More in this aisle"
              description="Discovery picks, not necessarily better swaps."
              layout="grid"
              gridColumns={4}
            />
          </Reveal>
        ) : null}

      </div>

      <SiteFooter />
    </main>
  );
}
