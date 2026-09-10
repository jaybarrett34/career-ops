// Plain .mjs so tests/lib/archetypes.test.mjs imports it directly under Node.

/**
 * The archetype registry — layer 2: which CV/targeting FLAVOR of one person.
 *
 * An archetype is the same career aimed differently: a backend-heavy resume and
 * an AI-engineering resume built from identical experience. Selecting one
 * changes which CV source is tailored, which keywords weight scoring, and
 * optionally which model runs.
 *
 * WHAT IT MUST NOT CHANGE, and why:
 *
 *   data/applications.md   ONE tracker per person. You applied to that job once,
 *                          whichever resume you sent. Splitting the tracker per
 *                          archetype would let the same posting be applied to
 *                          twice with no duplicate detection between them.
 *   reports/, scan-history shared, for the same reason
 *   portals.yml            overlay only — keywords are ADDED at scoring time and
 *                          the file is never rewritten, so switching archetype
 *                          can never silently edit the user's targeting config
 *
 * That asymmetry with roots.mjs is the whole point of two layers: a root swaps
 * everything, an archetype swaps presentation.
 *
 * NO MODEL NAMES LIVE IN THIS FILE OR ANYWHERE IN web/. modes/_shared.md states
 * its tier table is "the only place model/provider names appear". `model` is
 * carried as an opaque string from user config to the CLI's --model flag, so
 * this layer never learns what any model is called.
 */

/** @typedef {{id: string, label: string, tex: string|null, keywords: string[], model: string|null}} Archetype */

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/**
 * Normalize a parsed archetypes.yml. Never throws: a malformed entry is dropped
 * and reported so one bad row cannot cost the user every archetype.
 *
 * @param {unknown} parsed
 * @returns {{archetypes: Archetype[], errors: string[]}}
 */
export function normalizeArchetypes(parsed) {
  const errors = [];
  const archetypes = [];
  const seen = new Set();

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray(/** @type {any} */ (parsed).archetypes)
      ? /** @type {any} */ (parsed).archetypes
      : null;

  if (list === null) {
    if (parsed != null) errors.push("archetypes.yml must be a list, or a mapping with an `archetypes:` list");
    return { archetypes, errors };
  }

  for (const [i, raw] of list.entries()) {
    const where = `entry ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${where}: not a mapping`);
      continue;
    }
    const e = /** @type {Record<string, unknown>} */ (raw);
    const id = typeof e.id === "string" ? e.id.trim() : "";
    if (!ID_RE.test(id)) {
      errors.push(`${where}: missing or invalid id (letters, digits, - and _, max 64)`);
      continue;
    }
    if (seen.has(id.toLowerCase())) {
      errors.push(`${where}: duplicate id "${id}" — ignored`);
      continue;
    }
    seen.add(id.toLowerCase());

    const keywords = Array.isArray(e.keywords)
      ? e.keywords.filter((k) => typeof k === "string" && k.trim()).map((k) => k.trim())
      : [];
    if (e.keywords != null && !Array.isArray(e.keywords)) errors.push(`${where} ("${id}"): keywords must be a list — ignored`);

    archetypes.push({
      id,
      label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : id,
      // tex is optional. A missing or wrong path must degrade to the default CV
      // with a warning rather than fail a run — losing a tailored CV is an
      // inconvenience, failing the run loses the user's work.
      tex: typeof e.tex === "string" && e.tex.trim() ? e.tex.trim() : null,
      keywords,
      model: typeof e.model === "string" && e.model.trim() ? e.model.trim() : null,
    });
  }
  return { archetypes, errors };
}

/**
 * Resolve a requested archetype id against the registry.
 *
 * Unlike a root, an unknown archetype is harmless: it selects no overlay and the
 * app behaves as it did before the feature. So this falls back silently and
 * never errors — there is no filesystem access to guard here, only presentation.
 *
 * @param {Archetype[]} archetypes
 * @param {string|null|undefined} requestedId
 * @returns {Archetype|null}
 */
export function resolveArchetype(archetypes, requestedId) {
  if (!requestedId) return null;
  return archetypes.find((a) => a.id.toLowerCase() === String(requestedId).toLowerCase()) ?? null;
}

/**
 * The tagged Notes segment recording which archetype produced a tracker row.
 *
 * Deliberately the same shape as merge-tracker.mjs's existing `via=Agency`
 * convention: a tagged key=value, never prose, so a later parser can actually
 * find it. Prose ("built with the AI archetype") is unfindable and would make
 * this provenance write-only.
 *
 * @param {string|null} archetypeId
 * @returns {string} e.g. "archetype=ai_engineer", or "" when none is active
 */
export function archetypeNoteSegment(archetypeId) {
  if (!archetypeId || !ID_RE.test(archetypeId)) return "";
  return `archetype=${archetypeId}`;
}
