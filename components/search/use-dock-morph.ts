"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

/** Spring stiffness for glides: most of the move in ~0.4 s, then a soft settle. */
const OMEGA = 10;
/** easeInOutCubic, for what changes shape as the box docks. */
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";

type Metrics = { distance: number; lift: number; max: number; reduce: boolean };
/** A keyframe placed by docking progress p: 0 is the hero, 1 the docked box with the page under it. */
type Frame = Keyframe & { p: number };

/**
 * What each part of the home page does as it docks. The box rides the page at first and then
 * brakes into the dock, arriving just as the page below reaches it: it covers `lift` along
 * 1 - (1 - p)^n, with n picked so it starts at the page's own speed and ends at rest. Its sticky
 * position already stops it at the nav, so the dock's translate is what that leaves to travel.
 */
function parts({ distance, lift, reduce }: Metrics): [string, Frame[]][] {
  const n = Math.min(3, Math.max(1.2, distance / lift));
  const travelled = (p: number) => lift * (1 - (1 - p) ** n);
  const stuck = Math.min(1, lift / distance);
  const samples = [...new Set([...Array.from({ length: 33 }, (_, i) => i / 32), stuck])].sort((a, b) => a - b);
  const px = (v: number) => `translateY(${v.toFixed(2)}px)`;
  return [
    [".home-dock", samples.map(p => ({ p, transform: px(Math.min(p * distance, lift) - travelled(p)) }))],
    [".home-dock-band", [{ p: 0, opacity: 0 }, { p: 0.55, opacity: 0, easing: EASE }, { p: 1, opacity: 1 }]],
    [".home-box", [{ p: 0, width: "36rem", borderRadius: "18px", easing: EASE }, { p: 1, width: "100%", borderRadius: "14px" }]],
    [".home-box-shadow", [{ p: 0, opacity: 1, easing: EASE }, { p: 1, opacity: 0 }]],
    [".home-box-go", [{ p: 0, borderRadius: "13px", easing: EASE }, { p: 1, borderRadius: "10px" }]],
    // The chips stay with the box while they fade, then stop taking clicks.
    [".home-hero-foot", samples.filter(p => p <= 0.45).map(p => ({
      p,
      opacity: Math.max(0, 1 - p * 2.4),
      transform: px(p * distance - travelled(p)),
      visibility: p < 0.4 ? "visible" : "hidden",
    }))],
    // The headline lifts away a little faster than the page and fades.
    [".home-hero-copy", [
      { p: 0, opacity: 1, transform: "none" },
      { p: 0.74, opacity: 0 },
      { p: 1, opacity: 0, transform: reduce ? "none" : "translateY(-48px) scale(0.96)" },
    ]],
    [".home-hero-art", [{ p: 0, opacity: 1 }, { p: 1, opacity: 0 }]],
    [".home-below-rise", reduce ? [] : [{ p: 0, transform: "translateY(24px)", easing: EASE }, { p: 1, transform: "none" }]],
  ];
}

/** Places progress keyframes on the page's whole scroll range and holds the docked state after. */
function overScroll(frames: Frame[], { distance, max }: Metrics): Keyframe[] {
  const r = Math.min(1, distance / max);
  const out: Keyframe[] = frames.map(({ p, ...k }) => ({ ...k, offset: p * r }));
  const { offset: _o, easing: _e, ...last } = out[out.length - 1]!;
  return [...out, { ...last, offset: 1 }];
}

/**
 * The home page's search box docking under the nav. The hero, the box and the page below are
 * Web Animations keyed to scroll position (parts() above): on a ScrollTimeline where the browser
 * has one, so they move in the same frame as the scroll, else driven from scroll events.
 *
 * Releasing a scroll midway is settled by native scroll snapping on <html>, so it carries the
 * browser's own momentum; if the page still comes to rest in between, it glides on, the way it
 * was going. dock() and top() glide on a critically damped spring for searches and Back; snapping
 * is off during a glide, and any wheel, touch or key press hands control back.
 */
export function useDockMorph(dock: RefObject<HTMLElement | null>, below: RefObject<HTMLElement | null>) {
  const distance = useRef(1);
  const glide = useRef({ frame: 0, to: -1 });

  const stop = useCallback(() => {
    if (!glide.current.frame) return;
    cancelAnimationFrame(glide.current.frame);
    glide.current = { frame: 0, to: -1 };
    document.documentElement.classList.remove("home-gliding");
  }, []);

  const glideTo = useCallback((to: number) => {
    if (glide.current.frame && glide.current.to === to) return;
    stop();
    const from = window.scrollY;
    const d = to - from;
    if (Math.abs(d) < 1) return;
    if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo({ top: to, behavior: "instant" });
      return;
    }
    const root = document.documentElement;
    root.classList.add("home-gliding");
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / 1000;
      const left = d * (1 + OMEGA * t) * Math.exp(-OMEGA * t);
      const done = Math.abs(left) < 0.5;
      window.scrollTo({ top: done ? to : to - left, behavior: "instant" });
      if (done) {
        glide.current = { frame: 0, to: -1 };
        root.classList.remove("home-gliding");
      } else {
        glide.current.frame = requestAnimationFrame(step);
      }
    };
    glide.current = { frame: requestAnimationFrame(step), to };
  }, [stop]);

  useEffect(() => {
    const root = document.documentElement;
    const scope = dock.current?.closest("main") ?? document;
    const timeline = typeof ScrollTimeline === "function" ? new ScrollTimeline({ source: root, axis: "block" }) : null;
    let anims: Animation[] = [];
    let max = 1;
    let key = "";
    let frame = 0;
    let rest = 0;
    let lastY = window.scrollY;
    let down = true;
    let touching = false;
    // Without a ScrollTimeline the animations sit paused and scroll sets their time.
    const drive = () => {
      frame = 0;
      const t = 1000 * Math.min(1, Math.max(0, window.scrollY / max));
      for (const a of anims) a.currentTime = t;
    };
    const measure = () => {
      const d = dock.current;
      const b = below.current;
      if (!d || !b) return;
      const stickyTop = parseFloat(getComputedStyle(d).top) || 0;
      const foot = scope.querySelector<HTMLElement>(".home-hero-foot")?.offsetHeight ?? 0;
      const m: Metrics = {
        distance: Math.max(1, b.getBoundingClientRect().top + window.scrollY - stickyTop - d.offsetHeight),
        lift: 1,
        max: 1,
        reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
      m.lift = Math.max(1, m.distance - foot);
      m.max = Math.max(m.distance, root.scrollHeight - window.innerHeight);
      distance.current = m.distance;
      max = m.max;
      const next = `${m.distance}|${m.lift}|${m.max}|${m.reduce}`;
      if (next === key) return;
      key = next;
      for (const a of anims) a.cancel();
      anims = [];
      for (const [selector, frames] of parts(m)) {
        const el = scope.querySelector(selector);
        if (!el || !frames.length) continue;
        const a = el.animate(overScroll(frames, m), timeline ? { timeline, fill: "both" } : { duration: 1000, fill: "both" });
        if (!timeline) a.pause();
        anims.push(a);
      }
      if (!timeline) drive();
    };
    const settle = () => {
      if (touching || glide.current.frame) return;
      const p = window.scrollY / distance.current;
      if (p <= 0 || p >= 1) return;
      glideTo(down ? (p > 0.15 ? distance.current : 0) : (p < 0.85 ? 0 : distance.current));
    };
    const onScroll = () => {
      if (!timeline && !frame) frame = requestAnimationFrame(drive);
      if (glide.current.frame) return;
      const y = window.scrollY;
      if (y !== lastY) down = y > lastY;
      lastY = y;
      clearTimeout(rest);
      rest = window.setTimeout(settle, 260);
    };
    const onTouch = (e: TouchEvent) => {
      touching = e.type === "touchstart";
      clearTimeout(rest);
      if (!touching) rest = window.setTimeout(settle, 260);
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      if (!typing) stop();
    };
    const resize = new ResizeObserver(measure);
    resize.observe(document.body);
    root.classList.add("home-snap");
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("pointerdown", stop, { passive: true });
    window.addEventListener("keydown", onKey);
    for (const t of ["touchstart", "touchend", "touchcancel"] as const) window.addEventListener(t, onTouch, { passive: true });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      clearTimeout(rest);
      for (const t of ["touchstart", "touchend", "touchcancel"] as const) window.removeEventListener(t, onTouch);
      resize.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", onKey);
      for (const a of anims) a.cancel();
      root.classList.remove("home-snap");
    };
  }, [dock, below, stop, glideTo]);

  return useMemo(() => ({
    /** Glide until the box is docked with the page right under it. */
    dock: () => glideTo(distance.current),
    /** Glide back to the hero. */
    top: () => glideTo(0),
    docked: () => window.scrollY >= distance.current - 1,
  }), [glideTo]);
}
