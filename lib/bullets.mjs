const NORM = (s) => String(s).toLowerCase().replace(/\\[a-z]+\{([^}]*)\}/g, '$1')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function normalizeText(s) { return NORM(s); }

export function similarity(a, b) {
  const A = new Set(NORM(a).split(' ')), B = new Set(NORM(b).split(' '));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
}

export function groupVariants(items, threshold = 0.62) {
  const groups = [];
  for (const it of items) {
    const g = groups.find((g) => similarity(g.items[0].text, it.text) >= threshold
      && g.items[0].org === it.org);
    if (g) g.items.push(it); else groups.push({ items: [it] });
  }
  // Canonical = the longest, on the assumption the fullest phrasing carries the
  // most fact; shorter siblings become length variants rather than new bullets.
  return groups.map((g) => {
    const sorted = [...g.items].sort((a, b) => b.text.length - a.text.length);
    return { canonical: sorted[0], variants: sorted.slice(1) };
  });
}

export function slugId(org, text, taken = new Set()) {
  const o = NORM(org).split(' ').slice(0, 2).join('-') || 'x';
  const w = NORM(text).split(' ').filter((x) => x.length > 3).slice(0, 3).join('-');
  let base = `${o}-${w}`.slice(0, 48).replace(/-+$/, '');
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/**
 * Verbs that assert the user built the thing.
 *
 * Some roles are evaluation or advisory: the work is real, the authorship is
 * not. A bullet there saying "Built" is a fabrication of the most common kind --
 * tool-of-trade conflation -- and it is attractive precisely when that role
 * holds the best numbers, which is when the pull toward it is strongest.
 */
const AUTHORSHIP_VERBS = /\b(built|shipped|developed|implemented|authored|created|engineered|architected|designed|wrote|launched|deployed)\b/i;

/**
 * Enforce per-org authorship limits declared in the library itself.
 *
 * The TABLE is user data (which of MY employers limit authorship) and lives in
 * config/bullets.yml; the CHECK is system code. Hardcoding employer names here
 * would put one person's job history into shared code.
 *
 *   authorship_limits:
 *     Alignerr:
 *       reason: "specified and evaluated; did not ship the tooling"
 *       allow: ["designed"]        # optional per-org exceptions
 */
export function checkAuthorship(bullets, limits) {
  const out = [];
  for (const [org, rule] of Object.entries(limits ?? {})) {
    const allow = new Set((rule?.allow ?? []).map((v) => String(v).toLowerCase()));
    for (const b of bullets.filter((x) => x.org === org)) {
      const hit = AUTHORSHIP_VERBS.exec(`${b.text} ${b.short ?? ''}`);
      if (hit && !allow.has(hit[0].toLowerCase())) {
        out.push(`${b.id}: "${hit[0]}" claims authorship, but ${org} ${rule?.reason ?? 'limits authorship'}`);
      }
    }
  }
  return out;
}

export function validateLibrary(parsed) {
  const errors = [];
  const list = Array.isArray(parsed?.bullets) ? parsed.bullets : Array.isArray(parsed) ? parsed : null;
  if (list === null) return { bullets: [], errors: parsed == null ? [] : ['bullets.yml must be a list or a mapping with a `bullets:` list'] };
  const seen = new Set(); const out = [];
  for (const [i, b] of list.entries()) {
    if (!b || typeof b !== 'object') { errors.push(`entry ${i + 1}: not a mapping`); continue; }
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) { errors.push(`entry ${i + 1}: bad id`); continue; }
    if (seen.has(id)) { errors.push(`duplicate id "${id}"`); continue; }
    if (typeof b.text !== 'string' || !b.text.trim()) { errors.push(`${id}: missing text`); continue; }
    seen.add(id);
    out.push({
      id, org: String(b.org ?? '').trim(), text: b.text.trim(),
      short: typeof b.short === 'string' && b.short.trim() ? b.short.trim() : null,
      tags: Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === 'string') : [],
      variantOf: typeof b.variant_of === 'string' ? b.variant_of.trim() : null,
      // When the figures in this bullet were last confirmed, and by whom. A
      // number that has never been through a check is indistinguishable from a
      // correct one -- that is how a count master itself flagged as UNVERIFIED
      // shipped on resumes for weeks.
      verified: typeof b.verified === 'string' ? b.verified.trim() : null,
      archetypes: Array.isArray(b.archetypes) ? b.archetypes.filter((t) => typeof t === 'string') : [],
    });
  }
  errors.push(...checkAuthorship(out, parsed?.authorship_limits));
  return { bullets: out, errors };
}

export function selectBullets(library, ids, { preferShort = false } = {}) {
  const by = new Map(library.map((b) => [b.id.toLowerCase(), b]));
  const picked = []; const missing = [];
  for (const id of ids ?? []) {
    const b = by.get(String(id).toLowerCase());
    if (!b) { missing.push(id); continue; }
    picked.push({ ...b, rendered: preferShort && b.short ? b.short : b.text });
  }
  return { picked, missing };
}

export function siblingPhrasings(library, id) {
  const b = library.find((x) => x.id === id);
  if (!b) return [];
  const root = b.variantOf ?? b.id;
  return library.filter((x) => x.id !== id && (x.id === root || x.variantOf === root));
}

export function scoreAgainstKeywords(bullet, keywords) {
  if (!keywords?.length) return 0;
  const t = NORM(bullet.text + ' ' + (bullet.short ?? '') + ' ' + bullet.tags.join(' '));
  let hit = 0;
  for (const k of keywords) { if (k && t.includes(NORM(k))) hit++; }
  return hit;
}
