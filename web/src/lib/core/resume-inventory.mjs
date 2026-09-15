// Where every resume lives on disk, and whether the built PDF is still current.
//
// ADDRESSED BY ID, NEVER BY PATH
//
// config/resumes.yml is hand-edited, which puts it in the same trust position as
// config/roots.yml: it is the only source of servable paths, and a caller names
// an `id` that is looked up in it. Nothing here accepts a path from a request,
// so no request can reach a file the config does not already point at. That is
// the same property the profile registry has, for the same reason.
//
// Templates deliberately sit OUTSIDE the data root — the .tex archetypes live in
// their own repository — which is exactly why the Files route's containment rule
// cannot be reused here and why the id indirection is doing real work.

/** Candidate locations compose-resume.mjs writes a built PDF to, newest wins. */
export const PDF_CANDIDATES = (id) => [
  `output/${id}/${id}.pdf`,
  `output/rebuild/${id}.pdf`,
  `output/${id}.pdf`,
];

/**
 * Is the built PDF still what its inputs would produce?
 *
 * EXACT when a fingerprint is available, and only then. compose-resume writes
 * <id>.build.json recording a hash of the template plus every rendered bullet;
 * comparing that against the same hash recomputed now answers the question
 * precisely.
 *
 * The first version compared mtimes against config/resumes.yml, and that was
 * unusable: adding a field to ONE entry rewrites the whole file, so every PDF in
 * the inventory turned stale at once and the badge stopped meaning anything.
 * Coarse staleness that cries wolf is worse than none — it trains you to ignore
 * the one case that mattered.
 *
 * mtimes remain the FALLBACK for a PDF built before fingerprints existed, where
 * "older than the template or the library" is the best available answer.
 */
export function staleness(pdfMtime, inputMtimes, { recorded = null, current = null } = {}) {
  if (!pdfMtime) return { stale: true, reason: 'never built' };
  if (recorded && current) {
    return recorded === current
      ? { stale: false, reason: null }
      : { stale: true, reason: 'its bullets or template changed since it was built' };
  }
  const newer = Object.entries(inputMtimes)
    .filter(([, m]) => m && m > pdfMtime)
    .map(([k]) => k);
  return newer.length
    ? { stale: true, reason: `${newer.join(' and ')} changed since it was built` }
    : { stale: false, reason: null };
}

/**
 * Build the inventory.
 *
 * `fsq` is injected so this is testable without a filesystem: { exists, stat,
 * resolve, readJson }. `stat` returns { mtimeMs, size } or null.
 *
 * @param {Array<{id: string, template?: string, bullets?: string[], tailored_from?: string}>} resumes
 * @param {string} coreRoot
 * @param {{exists: Function, stat: Function, resolve: Function, readJson?: Function}} fsq
 * @param {{fingerprintOf?: ((r: object) => string | null) | null}} [opts]
 */
export function inventory(resumes, coreRoot, fsq, { fingerprintOf = null } = {}) {
  const cfg = {
    bullets: fsq.stat(fsq.resolve(coreRoot, 'config/bullets.yml'))?.mtimeMs ?? null,
  };

  return (resumes ?? []).map((r) => {
    const templatePath = r.template ? fsq.resolve(coreRoot, r.template) : null;
    const tpl = templatePath ? fsq.stat(templatePath) : null;

    let pdfPath = null, pdf = null;
    for (const rel of PDF_CANDIDATES(r.id)) {
      const p = fsq.resolve(coreRoot, rel);
      const st = fsq.stat(p);
      if (st && (!pdf || st.mtimeMs > pdf.mtimeMs)) { pdf = st; pdfPath = p; }
    }

    // The sidecar sits beside the PDF that produced it.
    const recorded = pdfPath ? fsq.readJson?.(pdfPath.replace(/\.pdf$/, '.build.json'))?.fingerprint ?? null : null;
    const current = fingerprintOf ? fingerprintOf(r) : null;

    const state = staleness(pdf?.mtimeMs ?? null, {
      'the template': tpl?.mtimeMs ?? null,
      'the bullet library': cfg.bullets,
    }, { recorded, current });

    return {
      id: r.id,
      // A resume tailor.mjs produced records what it came from; anything without
      // that marker is a foundational archetype the user maintains by hand.
      tailoredFrom: r.tailored_from ?? null,
      foundational: !r.tailored_from,
      bullets: Array.isArray(r.bullets) ? r.bullets.length : 0,
      templatePath,
      templateExists: Boolean(tpl),
      templateModified: tpl ? new Date(tpl.mtimeMs).toISOString() : null,
      pdfPath,
      pdfBytes: pdf?.size ?? null,
      pdfModified: pdf ? new Date(pdf.mtimeMs).toISOString() : null,
      ...state,
    };
  });
}

/** Resolve one id to a servable absolute path, or null. Never takes a path. */
export function fileForId(inv, id, which) {
  const row = inv.find((r) => r.id === id);
  if (!row) return null;
  if (which === 'tex') return row.templateExists ? row.templatePath : null;
  if (which === 'pdf') return row.pdfPath;
  return null;
}
