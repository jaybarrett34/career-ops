"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Motion primitives, hand-written.
 *
 * No animation library. reactbits-style components mostly ship on GSAP or
 * Framer Motion; adopting one for the handful of effects used here would be
 * ~50KB for behavior CSS already expresses. Everything below is a transition or
 * a rAF loop.
 *
 * EVERY effect here honours prefers-reduced-motion by SKIPPING TO THE END, not
 * by animating slower. A vestibular trigger avoided at half speed is still a
 * trigger, and a user who has asked for no motion wants the final state now.
 */

/** Has the viewer asked for reduced motion? Re-checks if they change it mid-session. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Count a number up when it first appears.
 *
 * The motion carries meaning rather than decoration: a tile that animates has
 * CHANGED, so a glance tells you which numbers moved since you last looked.
 * Non-numeric values (an em dash, "—") pass straight through.
 */
export function CountUp({
  value,
  durationMs = 650,
  className,
}: {
  value: number | string;
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  const animatable = Number.isFinite(numeric) && typeof value !== "string";
  const [shown, setShown] = useState(animatable ? 0 : numeric);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animatable || reduced) {
      setShown(numeric);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic: fast then settling, so the final value is readable early.
      setShown(Math.round(numeric * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [numeric, animatable, reduced, durationMs]);

  if (!animatable) return <span className={className}>{value}</span>;
  // tabular-nums so the width does not jitter while counting.
  return <span className={cn("tabular-nums", className)}>{shown}</span>;
}

/**
 * Stagger children in as they mount.
 *
 * Useful specifically on a list that CHANGES between visits — new scan hits
 * arriving in the pipeline. The stagger makes "these rows are new" legible
 * without a badge. On a static list it would be noise, so it is opt-in per use.
 */
export function AnimatedList({
  children,
  stepMs = 40,
  className,
}: {
  children: React.ReactNode;
  stepMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className={className}>
      {items.map((child, i) => (
        <div
          key={i}
          className={reduced ? undefined : "co-fade-in"}
          style={reduced ? undefined : { animationDelay: `${Math.min(i, 12) * stepMs}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

/**
 * A card that lights toward the cursor.
 *
 * Pure CSS custom properties updated on pointermove — no re-render per frame,
 * which is what makes this affordable on a list of cards. Disabled outright
 * under reduced motion and never attached on touch, where there is no hover and
 * the listener would only cost battery.
 */
export function SpotlightCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
      el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, [reduced]);

  return (
    <div ref={ref} className={cn("co-spotlight relative", className)}>
      {children}
    </div>
  );
}
