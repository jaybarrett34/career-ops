import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The reduced-motion contract, asserted structurally.
 *
 * The contract is "show the END STATE immediately", not "the same movement,
 * slower" — a vestibular trigger at half speed is still a trigger. That is easy
 * to state and easy to lose: someone adds a keyframe animation, ships it, and
 * nothing fails. These assertions are the thing that fails.
 */

const ROOT = path.resolve(import.meta.dirname, "../../src");
const CSS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
const MOTION = fs.readFileSync(path.join(ROOT, "components/ui/motion.tsx"), "utf8");

test("every custom animation class has a reduced-motion escape", () => {
  // Classes this project defines and animates.
  const animated = [...CSS.matchAll(/^\.(co-[a-z-]+)\s*\{[^}]*animation:/gms)].map((m) => m[1]);
  assert.ok(animated.length > 0, "no custom animated classes found — did the CSS move?");

  const reducedBlock = CSS.split("@media (prefers-reduced-motion: reduce)")[1] ?? "";
  for (const cls of animated) {
    assert.match(
      reducedBlock,
      new RegExp(`\\.${cls}\\b`),
      `.${cls} animates but is not disabled under prefers-reduced-motion`,
    );
  }
});

test("the reduced-motion block cancels rather than slows", () => {
  const block = CSS.split("@media (prefers-reduced-motion: reduce)")[1] ?? "";
  assert.ok(block.includes("animation: none") || block.includes("display: none"),
    "reduced-motion block should cancel animation, not retime it");
  // A shortened duration is the tempting wrong fix; catch it explicitly.
  assert.ok(!/animation-duration:\s*\d/.test(block),
    "reduced motion must not merely shorten a duration — it must not animate");
});

test("every motion component consults useReducedMotion", () => {
  const components = [...MOTION.matchAll(/export function (CountUp|AnimatedList|SpotlightCard)\b/g)].map((m) => m[1]);
  assert.deepEqual(components.sort(), ["AnimatedList", "CountUp", "SpotlightCard"]);
  for (const c of components) {
    const body = MOTION.split(`export function ${c}`)[1]?.split("\nexport function")[0] ?? "";
    assert.match(body, /useReducedMotion\(\)/, `${c} does not consult useReducedMotion`);
    assert.match(body, /reduced/, `${c} reads the hook but never branches on it`);
  }
});

test("no animation library was added", () => {
  // The decision was hand-written motion, no dependency. This is the assertion
  // that keeps a later "just add framer-motion" from passing silently.
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const banned of ["framer-motion", "motion", "gsap", "@react-spring/web", "react-spring", "animejs"]) {
    assert.ok(!(banned in deps), `${banned} was added; motion here is hand-written by decision`);
  }
});
