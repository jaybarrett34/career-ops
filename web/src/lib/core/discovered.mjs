// Companies and boards a scan surfaced that portals.yml does not already track.
//
// Without this a trawl is amnesiac: a company appears in one run's results and
// is gone the next, and the only durable record is the individual posting in
// pipeline.md. Recording the SOURCE means a profile accumulates its own map of
// where its roles actually come from, which is the whole starting point for a
// root that has no portals.yml yet.

const HOST_RE = /^https?:\/\/([^/?#]+)/i;

// Hosts shared by many employers. Two postings on boards.greenhouse.io say
// nothing about whether they are the same company, so host-based merging must
// never fire on these.
const SHARED_HOSTS = new Set([
  'boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io',
  'jobs.lever.co', 'jobs.ashbyhq.com', 'jobs.smartrecruiters.com',
  'myworkdayjobs.com', 'icims.com', 'oraclecloud.com', 'applicantpro.com',
  'workable.com', 'bamboohr.com', 'breezy.hr', 'jazzhr.com',
]);

export function isSharedHost(h) {
  if (!h) return true;
  if (SHARED_HOSTS.has(h)) return true;
  // Workday and iCIMS are per-tenant subdomains of one parent.
  return [...SHARED_HOSTS].some((s) => s.includes('.') && h.endsWith('.' + s));
}

export function hostOf(url) {
  const m = HOST_RE.exec(String(url ?? ''));
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/** Normalize a company name for comparison only; the display name is kept as-is. */
export function companyKey(name) {
  return String(name ?? '').toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|holdings|plc|gmbh)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Per-entry decision state.
 *
 * `open` is "no decision yet" and is what a scan writes. The other two are the
 * user's, and a scan never sets or clears them: a profile that has been curated
 * once should not be re-shuffled by every trawl, which is the whole point of
 * locking a person's list rather than letting it drift.
 */
export const LOCKS = new Set(['open', 'pinned', 'dismissed']);

const normLock = (v) => (LOCKS.has(v) ? v : 'open');

export function normalizeDiscovered(parsed) {
  const list = Array.isArray(parsed?.discovered) ? parsed.discovered : Array.isArray(parsed) ? parsed : [];
  const out = new Map();
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const name = typeof e.company === 'string' ? e.company.trim() : '';
    if (!name) continue;
    const key = companyKey(name);
    if (!key || out.has(key)) continue;
    out.set(key, {
      company: name,
      hosts: Array.isArray(e.hosts) ? [...new Set(e.hosts.filter((h) => typeof h === 'string'))] : [],
      sources: Array.isArray(e.sources) ? [...new Set(e.sources.filter((s) => typeof s === 'string'))] : [],
      count: Number.isFinite(e.count) && e.count > 0 ? Math.floor(e.count) : 0,
      firstSeen: typeof e.first_seen === 'string' ? e.first_seen : null,
      lastSeen: typeof e.last_seen === 'string' ? e.last_seen : null,
      promoted: e.promoted === true,
      lock: normLock(e.lock),
    });
  }
  return out;
}

/**
 * Fold this run's hits into the existing record.
 *
 * Counts accumulate rather than being replaced: a company that surfaces one
 * role a month for six months is a better target than one that dumped six in a
 * single run, and only a running total can tell them apart.
 *
 * `known` is the set of company keys portals.yml already tracks; those are
 * skipped so the file stays a list of things you have NOT decided about.
 */
export function mergeDiscoveries(existing, hits, { known = new Set(), today, source }) {
  const out = new Map(existing);
  let added = 0, updated = 0;
  for (const h of hits ?? []) {
    const name = String(h?.company ?? '').trim();
    const key = companyKey(name);
    if (!key || known.has(key)) continue;
    const host = hostOf(h?.url);
    // Name keys alone miss "Akuna" vs "Akuna Capital University". A shared
    // non-ATS host is strong evidence of one employer; a shared ATS host is
    // evidence of nothing.
    let prev = out.get(key);
    if (!prev && host && !isSharedHost(host)) {
      for (const e of out.values()) if (e.hosts.includes(host)) { prev = e; break; }
    }
    if (prev) {
      // A dismissed entry still counts. Skipping it would drop it from the file,
      // and the next sighting would file it as a fresh open entry -- silently
      // undoing the decision.
      prev.count += 1;
      prev.lastSeen = today;
      if (host && !prev.hosts.includes(host)) prev.hosts.push(host);
      if (source && !prev.sources.includes(source)) prev.sources.push(source);
      updated++;
    } else {
      out.set(key, {
        company: name,
        hosts: host ? [host] : [],
        sources: source ? [source] : [],
        count: 1, firstSeen: today, lastSeen: today, promoted: false, lock: 'open',
      });
      added++;
    }
  }
  return { merged: out, added, updated };
}

export function toYaml(map) {
  const rows = [...map.values()].sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
  const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const out = [
    '# Companies a scan surfaced that portals.yml does not track.',
    '# Ordered by how often they have come up. Set promoted: true to move one',
    '# into portals.yml tracked_companies; nothing here is scanned on its own.',
    'discovered:',
  ];
  for (const r of rows) {
    out.push(`  - company: ${q(r.company)}`);
    if (r.hosts.length) out.push(`    hosts: [${r.hosts.map(q).join(', ')}]`);
    if (r.sources.length) out.push(`    sources: [${r.sources.map(q).join(', ')}]`);
    out.push(`    count: ${r.count}`);
    if (r.firstSeen) out.push(`    first_seen: ${r.firstSeen}`);
    if (r.lastSeen) out.push(`    last_seen: ${r.lastSeen}`);
    if (r.promoted) out.push('    promoted: true');
    if (r.lock && r.lock !== 'open') out.push(`    lock: ${r.lock}`);
  }
  return out.join('\n') + '\n';
}

/**
 * Entries worth offering for promotion.
 *
 * Pinned entries qualify at any count -- pinning IS the decision, and holding a
 * pinned company back because it has only been seen once would make the pin do
 * nothing. Dismissed entries never qualify.
 */
export function promotionCandidates(map, { minCount = 2 } = {}) {
  return [...map.values()]
    .filter((r) => !r.promoted && r.lock !== 'dismissed' && (r.lock === 'pinned' || r.count >= minCount))
    .sort((a, b) => (a.lock === 'pinned' ? 0 : 1) - (b.lock === 'pinned' ? 0 : 1) || b.count - a.count);
}

/**
 * Set one entry's lock, returning a new map.
 *
 * Keyed by companyKey rather than by display name so the id the UI round-trips
 * is the same id the merge uses; a caller cannot create an entry this way.
 */
export function setLock(map, key, lock) {
  if (!LOCKS.has(lock)) throw new Error(`unknown lock: ${lock}`);
  const out = new Map();
  let found = false;
  for (const [k, v] of map) {
    if (k === key) { found = true; out.set(k, { ...v, lock }); } else out.set(k, v);
  }
  return { map: out, found };
}
