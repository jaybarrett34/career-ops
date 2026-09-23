// Does a posting's own stated requirements rule the candidate out?
//
// WHY THIS IS A GATE AND NOT A SCORE
//
// Graduation windows are the filter that actually decided things in this search
// and nothing checked them. On one day's Chicago listings: Northern Trust wanted
// December 2027 - Summer 2028 (fits), Motorola "on or after December 2027"
// (fits), CIBC December 2026 - June 2027 (a BA six months early and an MS six
// months late — a genuine skip that read as a target until the JD was opened),
// The Hartford May 2028 only, Medline undergraduates only. Four of eight Chicago
// postings checked by hand. It does not correlate with company, location or
// title, so it cannot be inferred from a listing row — only the JD says it.
//
// ONLY A CONFIRMED MISMATCH REJECTS
//
// A posting that states no window, or states one this cannot parse, comes back
// `unknown` and passes. A missed opening is invisible and a false rejection is
// permanent; noise is merely annoying. The same asymmetry the scanners use.

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
// Seasons as the month a term actually ENDS, which is what a graduation date is.
const SEASONS = { winter: 12, spring: 5, summer: 8, fall: 12, autumn: 12 };

/** "December 2027" / "Dec 2027" / "Summer 2028" → {y, m}, else null. */
export function parseTerm(s) {
  const t = String(s ?? '').toLowerCase().trim();
  let m = /\b([a-z]+)\s+(20\d\d)\b/.exec(t);
  if (m) {
    const month = MONTHS[m[1]] ?? SEASONS[m[1]];
    if (month) return { y: Number(m[2]), m: month };
  }
  m = /\b(20\d\d)\b/.exec(t);
  return m ? { y: Number(m[1]), m: 6 } : null; // a bare year: treat as mid-year
}

const ord = (t) => (t ? t.y * 12 + t.m : null);

/**
 * The graduation window a posting states, if it states one.
 *
 * Handles the four shapes seen in real postings: a range ("between December
 * 2027 and Summer 2028", "December 2027/Summer 2028"), a floor ("on or after
 * December 2027"), a ceiling ("by May 2027"), and a single term ("expecting to
 * graduate in May 2028").
 */
export function parseGraduationWindow(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  const TERM = '([A-Za-z]+\\s+20\\d\\d|20\\d\\d)';

  let m = new RegExp(`graduat\\w*[^.;]{0,60}?between\\s+${TERM}\\s*(?:and|-|–|to)\\s*${TERM}`, 'i').exec(t)
    || new RegExp(`graduat\\w*[^.;]{0,60}?${TERM}\\s*(?:/|-|–|to|through)\\s*${TERM}`, 'i').exec(t);
  if (m) return { from: parseTerm(m[1]), to: parseTerm(m[2]), kind: 'range' };

  m = new RegExp(`graduat\\w*[^.;]{0,40}?on or after\\s+${TERM}`, 'i').exec(t)
    || new RegExp(`graduat\\w*[^.;]{0,40}?(?:no earlier than|after)\\s+${TERM}`, 'i').exec(t);
  if (m) return { from: parseTerm(m[1]), to: null, kind: 'floor' };

  m = new RegExp(`graduat\\w*[^.;]{0,40}?(?:no later than|by|before)\\s+${TERM}`, 'i').exec(t);
  if (m) return { from: null, to: parseTerm(m[1]), kind: 'ceiling' };

  m = new RegExp(`(?:graduating|graduate|graduation)[^.;]{0,40}?\\bin\\s+${TERM}`, 'i').exec(t)
    || new RegExp(`expect\\w*\\s+to\\s+graduate[^.;]{0,30}?${TERM}`, 'i').exec(t)
    || new RegExp(`graduation date[^.;]{0,30}?${TERM}`, 'i').exec(t);
  if (m) {
    const term = parseTerm(m[1]);
    return { from: term, to: term, kind: 'single' };
  }
  return null;
}

/**
 * Fields a degree can stand in for.
 *
 * Deliberately LOOSE. An MS in AI for Business is read by a human recruiter as
 * satisfying "computer science, information systems, data science or a related
 * field", and a gate that demanded the exact string would reject postings the
 * candidate would in fact be considered for. The looseness is the point: this
 * rejects only what is clearly outside, such as a posting that wants nursing.
 */
export const FIELD_SYNONYMS = {
  'ai for business': ['computer science', 'cs', 'information systems', 'mis', 'management information systems',
    'data science', 'analytics', 'business analytics', 'information technology', 'it', 'artificial intelligence',
    'machine learning', 'business', 'technical field', 'related field', 'quantitative', 'engineering', 'stem'],
  'computer science': ['computer science', 'cs', 'software engineering', 'computer engineering',
    'information systems', 'information technology', 'data science', 'engineering', 'technical field',
    'related field', 'stem'],
};

/** Every field name this candidate can credibly claim. */
export function claimableFields(degrees) {
  const out = new Set();
  for (const d of degrees ?? []) {
    const key = String(d.field ?? '').toLowerCase();
    out.add(key);
    for (const syn of FIELD_SYNONYMS[key] ?? []) out.add(syn);
  }
  return [...out];
}

/** Degrees that are inside the posting's window, with a verdict. */
export function checkGraduation(jdText, degrees) {
  const win = parseGraduationWindow(jdText);
  if (!win || (!win.from && !win.to)) {
    return { verdict: 'unknown', reason: 'the posting states no graduation window', window: null };
  }
  const lo = ord(win.from), hi = ord(win.to);
  const fits = (degrees ?? []).filter((d) => {
    const g = ord(parseTerm(d.graduates));
    if (g == null) return false;
    // A one-month grace at each edge: "Summer 2028" and "July 2028" are the same
    // intent written two ways, and a rejection on that difference is wrong.
    if (lo != null && g < lo - 1) return false;
    if (hi != null && g > hi + 1) return false;
    return true;
  });
  const fmt = (t) => (t ? `${t.y}-${String(t.m).padStart(2, '0')}` : '—');
  if (fits.length) {
    return { verdict: 'eligible', window: win, via: fits.map((d) => d.label ?? d.field),
      reason: `${fits.map((d) => d.label ?? d.field).join(', ')} falls inside ${fmt(win.from)}..${fmt(win.to)}` };
  }
  return {
    verdict: 'ineligible', window: win, via: [],
    reason: `the posting wants ${fmt(win.from)}..${fmt(win.to)}; `
      + `you graduate ${(degrees ?? []).map((d) => `${d.label ?? d.field} ${d.graduates}`).join(' and ')}`,
  };
}

/** Does the posting restrict to a degree level this candidate has left behind? */
export function checkLevel(jdText, degrees) {
  const t = String(jdText ?? '').toLowerCase();
  const undergradOnly = /\b(rising (senior|junior)|undergraduate (students?|programs?) only|open to rising|currently an undergraduate)\b/.test(t)
    && !/\b(graduate student|master'?s|mba|phd)\b/.test(t);
  const phdOnly = /\b(phd|doctoral)\b/.test(t) && !/\b(master'?s|bachelor'?s|mba)\b/.test(t);
  const levels = new Set((degrees ?? []).map((d) => String(d.level ?? '').toLowerCase()));
  if (undergradOnly && !levels.has('bachelors-in-progress')) {
    return { verdict: 'ineligible', reason: 'open to current undergraduates only' };
  }
  if (phdOnly && !levels.has('phd')) {
    return { verdict: 'ineligible', reason: 'PhD only' };
  }
  return { verdict: 'unknown', reason: null };
}

/** One verdict for a posting. Ineligible only on a CONFIRMED mismatch. */
export function eligibility(jdText, profile) {
  const degrees = profile?.degrees ?? [];
  const grad = checkGraduation(jdText, degrees);
  const level = checkLevel(jdText, degrees);
  if (level.verdict === 'ineligible') return { ...level, check: 'degree level' };
  if (grad.verdict === 'ineligible') return { ...grad, check: 'graduation window' };
  if (grad.verdict === 'eligible') return { ...grad, check: 'graduation window' };
  return { verdict: 'unknown', check: 'graduation window', reason: grad.reason, window: null };
}
