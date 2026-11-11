"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

/** Spring stiffness for glides: most of the move in ~0.4 s, then a soft settle. */
const OMEGA = 10;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const between = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/**
 * The home page's search box docking under the nav. Scroll progress from the hero (0) to the
 * docked box with the page right under it (1) goes to CSS variables on <html>: --home-p
 * (linear), --home-e (eased) and --home-band (the docked strip); globals.css draws the rest.
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
    let frame = 0;
    let rest = 0;
    let lastY = window.scrollY;
    let down = true;
    let touching = false;
    const paint = () => {
      frame = 0;
      const p = Math.min(1, Math.max(0, window.scrollY / distance.current));
      root.style.setProperty("--home-p", p.toFixed(4));
      root.style.setProperty("--home-e", ease(p).toFixed(4));
      root.style.setProperty("--home-band", between(0.8, 1, p).toFixed(4));
    };
    const measure = () => {
      const d = dock.current;
      const b = below.current;
      if (!d || !b) return;
      const stickyTop = parseFloat(getComputedStyle(d).top) || 0;
      distance.current = Math.max(1, b.getBoundingClientRect().top + window.scrollY - stickyTop - d.offsetHeight);
      paint();
    };
    const settle = () => {
      if (touching || glide.current.frame) return;
      const p = window.scrollY / distance.current;
      if (p <= 0 || p >= 1) return;
      glideTo(down ? (p > 0.15 ? distance.current : 0) : (p < 0.85 ? 0 : distance.current));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
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
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", onKey);
      root.classList.remove("home-snap");
      for (const v of ["--home-p", "--home-e", "--home-band"]) root.style.removeProperty(v);
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
