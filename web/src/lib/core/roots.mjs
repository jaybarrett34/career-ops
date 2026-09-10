// Plain .mjs so tests/lib/roots.test.mjs imports it directly under Node.
// Import with the .mjs extension included.

/**
 * The root registry — which PEOPLE this install can act as.
 *
 * A "root" is one person's complete career-ops data root: their cv.md,
 * config/profile.yml, data/applications.md, reports/. Switching roots switches
 * ALL of it. This is deliberately not the same axis as an archetype, which
 * overlays targeting and CV *within* one person's data.
 *
 * SECURITY MODEL — why this file is more careful than its size suggests:
 *
 * The registry is the ONLY source of selectable paths, and it is HAND-EDITED.
 * The web app never writes a path into it. That is not an arbitrary rule:
 *
 *   - The read side is closed by the API taking an `id` and never a path. A
 *     client that could name a path would hold a directory-traversal read
 *     primitive against the user's disk, since the resolved root is then handed
 *     to file reads all over the app.
 *   - The write side is closed by there being no writer. An "Add root" form
 *     would reintroduce exactly the primitive the read side closes, just
 *     through a different door.
 *
 * Adding a root is therefore a deliberate act of editing a file on disk. For a
 * local-first, single-operator app that is the correct trade: the cost is one
 * text edit, and the benefit is that no request shape can ever widen the set of
 * readable directories.
 *
 * ABSENT REGISTRY IS THE NORMAL CASE. With no config/roots.yml, this returns a
 * single implicit root and the UI hides the switcher, so behavior is byte-for-
 * byte what it was before this feature existed.
 */

/** @typedef {{id: string, label: string, path: string, enabled: boolean}} Root */
/** @typedef {{ok: true} | {ok: false, reason: string}} Check */

/** ids are used in URLs, cookies and filenames — keep them boring. */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/**
 * Normalize a parsed roots.yml into a registry.
 *
 * Never throws: a malformed entry is DROPPED and reported, and the rest of the
 * file still works. A registry that refuses to load at all because of one bad
 * row would lock the user out of every root, which is strictly worse than
 * operating without the bad one.
 *
 * @param {unknown} parsed  Result of yaml.load() — any shape.
 * @returns {{roots: Root[], errors: string[]}}
 */
export function normalizeRoots(parsed) {
  const errors = [];
  const roots = [];
  const seen = new Set();

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray(/** @type {any} */ (parsed).roots)
      ? /** @type {any} */ (parsed).roots
      : null;

  if (list === null) {
    if (parsed != null) errors.push("roots.yml must be a list, or a mapping with a `roots:` list");
    return { roots, errors };
  }

  for (const [i, raw] of list.entries()) {
    const where = `entry ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${where}: not a mapping`);
      continue;
    }
    const e = /** @type {Record<string, unknown>} */ (raw);
    const id = typeof e.id === "string" ? e.id.trim() : "";
    const p = typeof e.path === "string" ? e.path.trim() : "";

    if (!ID_RE.test(id)) {
      errors.push(`${where}: missing or invalid id (letters, digits, - and _, max 64)`);
      continue;
    }
    if (seen.has(id.toLowerCase())) {
      errors.push(`${where}: duplicate id "${id}" — ignored`);
      continue;
    }
    if (!p) {
      errors.push(`${where} ("${id}"): missing path`);
      continue;
    }
    seen.add(id.toLowerCase());
    roots.push({
      id,
      label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : id,
      path: p,
      // Opt-OUT: a listed root is usable unless explicitly disabled. Someone who
      // added it meant to use it.
      enabled: e.enabled !== false,
    });
  }
  return { roots, errors };
}

/**
 * Is this root safe and sensible to act as?
 *
 * "Contains a career-ops user layer" is the real check — an existing but empty
 * directory would otherwise be selectable and would then read as a career-ops
 * install with no data, which looks identical to data loss.
 *
 * @param {Root} root
 * @param {{isDir: (p: string) => boolean, exists: (p: string) => boolean, resolve: (...a: string[]) => string}} fsq
 * @returns {Check}
 */
export function checkRoot(root, fsq) {
  if (!root.enabled) return { ok: false, reason: "disabled in config/roots.yml" };
  const abs = fsq.resolve(root.path);
  if (!fsq.exists(abs)) return { ok: false, reason: `path does not exist: ${abs}` };
  if (!fsq.isDir(abs)) return { ok: false, reason: `not a directory: ${abs}` };
  const hasUserLayer = fsq.exists(fsq.resolve(abs, "cv.md")) || fsq.exists(fsq.resolve(abs, "config/profile.yml"));
  if (!hasUserLayer) return { ok: false, reason: "no cv.md or config/profile.yml — not a career-ops data root" };
  return { ok: true };
}

/**
 * Resolve a requested root id to an absolute path.
 *
 * THE TRAVERSAL GATE. `requestedId` is attacker-controlled in the general case
 * (it arrives from a cookie or a request body). It is only ever compared
 * against ids already in the registry and is NEVER used to build a path, so no
 * value of it can widen the set of reachable directories. An unknown id falls
 * back to the default root rather than erroring, because a stale cookie from a
 * removed root must not brick the app.
 *
 * @param {Root[]} roots
 * @param {string | null | undefined} requestedId
 * @param {string} defaultRoot Absolute path used when nothing is selected.
 * @param {(r: Root) => Check} check
 * @param {(...a: string[]) => string} resolve
 * @returns {{path: string, id: string | null, fellBack: boolean, reason?: string}}
 */
export function resolveActiveRoot(roots, requestedId, defaultRoot, check, resolve) {
  if (!requestedId) return { path: defaultRoot, id: null, fellBack: false };

  const match = roots.find((r) => r.id.toLowerCase() === String(requestedId).toLowerCase());
  if (!match) {
    return { path: defaultRoot, id: null, fellBack: true, reason: `unknown root "${requestedId}"` };
  }
  const verdict = check(match);
  if (!verdict.ok) {
    return { path: defaultRoot, id: null, fellBack: true, reason: `root "${match.id}" unusable: ${verdict.reason}` };
  }
  return { path: resolve(match.path), id: match.id, fellBack: false };
}
