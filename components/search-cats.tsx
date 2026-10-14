"use client";

import type { DotLottie } from "@lottiefiles/dotlottie-react";
import { useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { LOTTIE_ASSETS, type LottieAsset } from "@/lib/lottie-manifest";

/**
 * Search-loader mascot — ONE professionally-animated Lottie cat per search.
 * A random asset is picked on mount from the auto-discovered manifest (sync via
 * `pnpm cats:sync`; source folder is ~/Downloads/scout-cats/). It loops in place
 * — or, for assets marked `cross` in cats.config.json (Kiki on her broom, etc.),
 * flies the full width on a continuous loop.
 *
 * Player is lazy-loaded (next/dynamic, ssr:false) → the wasm renderer stays out
 * of the initial bundle and only loads when a search runs. One mount = one cat,
 * so there's no swap / ghost risk that the carousel had. Reduced-motion → calm
 * centred cat, no fly-across.
 *
 * SSR uses a deterministic first entry; the random pick happens after mount, so
 * there's never a hydration mismatch.
 */

const DotLottieReact = dynamic(
  () => import("@lottiefiles/dotlottie-react").then((m) => m.DotLottieReact),
  { ssr: false, loading: () => null },
);

const CANVAS = 196;
const FALLBACK: LottieAsset = LOTTIE_ASSETS[0] ?? { src: "preloader-cat.json" };

export function SearchCats({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const [asset, setAsset] = useState<LottieAsset>(FALLBACK);
  const [show, setShow] = useState(false);

  // Random pick + fade-in happen only after hydration → no SSR/client mismatch
  // and no stale-frame flash before the new animation has painted.
  useEffect(() => {
    if (!LOTTIE_ASSETS.length) return;
    const next = LOTTIE_ASSETS[Math.floor(Math.random() * LOTTIE_ASSETS.length)]!;
    setAsset(next);
    const t = setTimeout(() => setShow(true), 220);
    return () => clearTimeout(t);
  }, []);

  const isCross = !!asset.cross && !reduce;

  // Lottie canvases sometimes carry their own bg fill — force transparent so the
  // page tone shows through.
  const onPlayerRef = useCallback((dotLottie: DotLottie | null) => {
    dotLottie?.setBackgroundColor("transparent");
  }, []);

  return (
    <div className={`relative h-[190px] w-full overflow-hidden ${className}`} aria-hidden>
      <style>{FLY_STYLE}</style>
      <div
        className="absolute inset-0 transition-opacity duration-300 ease-out"
        style={{ opacity: show ? 1 : 0 }}
      >
        <div
          className={`absolute top-1/2 ${isCross ? "cat-fly" : ""}`}
          style={
            isCross
              ? ({ ["--cw" as string]: `${CANVAS}px`, animationName: asset.cross === "rtl" ? "catFlyRtl" : "catFlyLtr", transform: "translateY(-50%)" } as React.CSSProperties)
              : { left: "50%", transform: "translate(-50%, -50%)" }
          }
        >
          <DotLottieReact
            src={`/lottie/${asset.src}`}
            loop
            autoplay
            style={{ width: CANVAS, height: CANVAS }}
            dotLottieRefCallback={onPlayerRef}
          />
        </div>
      </div>
    </div>
  );
}

const FLY_STYLE = `
.cat-fly { animation-duration: 7s; animation-timing-function: linear; animation-iteration-count: infinite; will-change: left; }
@keyframes catFlyRtl { from { left: 100%; } to { left: calc(-1 * var(--cw)); } }
@keyframes catFlyLtr { from { left: calc(-1 * var(--cw)); } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .cat-fly { animation: none; left: 50%; transform: translate(-50%, -50%) !important; } }
`;
