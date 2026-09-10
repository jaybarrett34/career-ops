// SPIKE — does AsyncLocalStorage carry a per-request value down to the sync
// leaf callers of careerOpsRoot()? If yes, entry points wrap once and all 38
// existing callers see the active root with no change. If no, every caller has
// to become async, which is a different and much larger feature.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

/** Run `fn` with `root` as the active data root for everything it awaits. */
export function withRoot(root, fn) {
  return store.run({ root }, fn);
}

/** The active root, or null when called outside any withRoot() scope. */
export function activeRoot() {
  return store.getStore()?.root ?? null;
}
