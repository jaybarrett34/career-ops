// Plain .mjs so tests/lib/*.test.mjs import it directly under Node.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request active profile: which person's data root this request acts on.
 *
 * WHY ASYNC-LOCAL STORAGE, AND WHAT IT BUYS
 *
 * careerOpsRoot() is SYNCHRONOUS and has 38 callers. Threading a root argument
 * through all of them would mean making each one async and touching every call
 * site — a far larger change than the feature warrants, and one that would have
 * to be repeated for the archetype overlay.
 *
 * A spike against the real app (Next 16.3.3, Node 22.14) confirmed ALS carries a
 * value from an entry point, through `await` boundaries and several stack
 * frames, down to a synchronous leaf, and that the scope closes cleanly
 * afterwards. So an entry point wraps once and every existing caller beneath it
 * sees the active root unchanged.
 *
 * WHAT THE SPIKE ALSO RULED OUT — read before "simplifying" this
 *
 *   - Wrapping the root layout does NOT work. React renders child pages in a
 *     separate async context; a child read `null` while the layout held a scope.
 *     There is no single global place to wrap.
 *   - Middleware (`src/proxy.ts` — Next 16's rename of middleware.ts) does NOT
 *     work either. Middleware runs to completion BEFORE the handler, so it
 *     cannot hold a scope open across it. It is a filter, not a wrapper; it can
 *     validate and annotate a request, nothing more.
 *
 * Both facts are why every entry point wraps itself, and why
 * tests/lib/entry-point-coverage.test.mjs enforces that mechanically.
 *
 * THE SILENT-FALLBACK HAZARD
 *
 * activeRoot() returns null outside any scope and careerOpsRoot() then falls
 * back to the default root. That keeps an unwrapped entry point WORKING rather
 * than crashing — deliberately, so a missed route degrades to today's behavior.
 * The cost is that the failure is invisible: the page would read the default
 * person's tracker while the switcher claims another. Nothing in review catches
 * that, which is the entire reason the coverage test exists.
 */

/** @typedef {{root: string, rootId: string | null, archetypeId: string | null}} ActiveProfile */

const store = new AsyncLocalStorage();

/**
 * Run `fn` with `profile` active for everything it awaits.
 *
 * @template T
 * @param {ActiveProfile} profile
 * @param {() => T} fn
 * @returns {T}
 */
export function withProfile(profile, fn) {
  return store.run(profile, fn);
}

/** The active profile, or null outside any withProfile() scope. */
export function activeProfile() {
  return store.getStore() ?? null;
}

/** The active data root, or null outside any scope. Callers fall back themselves. */
export function activeRoot() {
  return store.getStore()?.root ?? null;
}

/** The active archetype id, or null. Layer 2; independent of the root. */
export function activeArchetypeId() {
  return store.getStore()?.archetypeId ?? null;
}
