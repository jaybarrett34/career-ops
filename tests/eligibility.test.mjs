import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTerm, parseGraduationWindow, claimableFields, checkGraduation, checkLevel, eligibility,
} from '../lib/eligibility.mjs';

// Alex's actual degrees — the cases below are the real postings this was built from.
const PROFILE = {
  degrees: [
    { label: 'BA Computer Science', field: 'computer science', level: 'bachelors', graduates: 'May 2026' },
    { label: 'MS AI for Business', field: 'ai for business', level: 'masters', graduates: 'December 2027' },
  ],
};

test('terms parse from the forms postings actually use', () => {
  assert.deepEqual(parseTerm('December 2027'), { y: 2027, m: 12 });
  assert.deepEqual(parseTerm('Dec 2027'), { y: 2027, m: 12 });
  assert.deepEqual(parseTerm('Summer 2028'), { y: 2028, m: 8 });
  assert.deepEqual(parseTerm('Spring 2027'), { y: 2027, m: 5 });
  assert.equal(parseTerm('sometime'), null);
});

test('Northern Trust — a range that fits the MS', () => {
  const jd = 'expected graduation date between December 2027 and Summer 2028';
  const r = eligibility(jd, PROFILE);
  assert.equal(r.verdict, 'eligible');
  assert.deepEqual(r.via, ['MS AI for Business']);
});

test('CIBC — the window that straddles both degrees', () => {
  // The BA is six months early and the MS six months late. This read as a
  // target until the JD was opened, which is the entire reason this gate exists.
  const jd = 'currently a junior or senior ... with an expected graduation date between December 2026 and June 2027.';
  const r = eligibility(jd, PROFILE);
  assert.equal(r.verdict, 'ineligible');
  assert.match(r.reason, /2026-12\.\.2027-06/);
});

test('Motorola — a floor the MS clears', () => {
  assert.equal(eligibility('Must have a graduation date on or after December 2027.', PROFILE).verdict, 'eligible');
});

test('The Hartford — a single term five months early', () => {
  const jd = 'Undergraduate or graduate student expecting to graduate in May 2028 with a Bachelor\'s or Master\'s';
  assert.equal(eligibility(jd, PROFILE).verdict, 'ineligible');
});

test('BCG — a slash range that fits', () => {
  const jd = 'demonstrated interest in technology; graduating between December 2027 and July 2028.';
  assert.equal(eligibility(jd, PROFILE).verdict, 'eligible');
});

test('Medline — undergraduates only', () => {
  const jd = 'open to rising seniors in undergraduate programs. Rising senior or junior pursuing a bachelor\'s degree.';
  const r = eligibility(jd, PROFILE);
  assert.equal(r.verdict, 'ineligible');
  assert.match(r.reason, /undergraduate/i);
});

test('a PhD-only posting is refused', () => {
  assert.equal(eligibility('Data Scientist Research Intern. Must be enrolled in a PhD or doctoral program.', PROFILE).verdict, 'ineligible');
});

test('a posting naming no window passes as unknown, never as ineligible', () => {
  // The asymmetry: a missed opening is invisible and permanent; noise is merely
  // annoying. Silence about a requirement is not evidence of failing it.
  const r = eligibility('We are looking for a software engineering intern for Summer 2027.', PROFILE);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.window, null);
});

test('an unparseable window also passes rather than guessing', () => {
  assert.equal(eligibility('graduating at some point in the next couple of years', PROFILE).verdict, 'unknown');
});

test('a season and its month are not treated as different', () => {
  // "Summer 2028" and "July 2028" are one intent written two ways; rejecting on
  // that difference would be wrong.
  const p = { degrees: [{ label: 'MS', field: 'cs', level: 'masters', graduates: 'July 2028' }] };
  assert.equal(checkGraduation('graduating between December 2027 and Summer 2028', p.degrees).verdict, 'eligible');
});

test('AI for Business claims the CS and MIS field names', () => {
  // The looseness he asked for: a human recruiter reads an AI-for-Business MS
  // as satisfying "computer science, information systems or a related field".
  const f = claimableFields(PROFILE.degrees);
  for (const want of ['computer science', 'mis', 'management information systems',
    'information systems', 'data science', 'analytics', 'related field', 'stem']) {
    assert.ok(f.includes(want), `should claim "${want}"`);
  }
});

test('checkLevel does not fire when a posting welcomes graduate students too', () => {
  const jd = 'open to rising seniors and graduate students pursuing a master\'s degree';
  assert.equal(checkLevel(jd, PROFILE.degrees).verdict, 'unknown');
});

// ---------------------------------------------------------------------------
// Regressions from the 2026-09-23 review. Each of these was a PERMANENT false
// rejection -- the one failure mode this module's header says must never happen.

test('"BS, MS, or PhD" is not read as PhD-only', () => {
  // The most common degree line in tech spells neither "bachelor's" nor
  // "master's", so a negative lookaside built from those two words classified it
  // PhD-only and target-list --check-eligibility deleted the row.
  for (const jd of ['BS, MS, or PhD in Computer Science or related field.',
    'Pursuing a BS/MS/PhD degree.',
    'B.S. or Ph.D. in a technical field.',
    'Bachelors, Masters or PhD candidates welcome.']) {
    assert.equal(eligibility(jd, PROFILE).verdict, 'unknown', jd);
  }
});

test('a posting that really is PhD-only still rejects', () => {
  const jd = 'Currently enrolled in a Ph.D. program. PhD candidates only.';
  assert.equal(eligibility(jd, PROFILE).verdict, 'ineligible');
});

test('a bare year on the POSTING side spans the whole year', () => {
  // "graduating in 2027" collapsed to June 2027, so a December 2027 graduate was
  // rejected by a posting that wanted exactly them.
  const dec = { degrees: [{ label: 'MS', field: 'cs', level: 'masters', graduates: 'December 2027' }] };
  const jan = { degrees: [{ label: 'MS', field: 'cs', level: 'masters', graduates: 'January 2027' }] };
  assert.equal(eligibility('Must be graduating in 2027.', dec).verdict, 'eligible');
  assert.equal(eligibility('Must be graduating in 2027.', jan).verdict, 'eligible');
  assert.equal(eligibility('Must be graduating in 2027.',
    { degrees: [{ label: 'MS', field: 'cs', graduates: 'May 2029' }] }).verdict, 'ineligible');
});

test('a bare year on the CANDIDATE side still reads as mid-year', () => {
  // The widening belongs to the posting's edges only; for the candidate's own
  // date a single guess is all there is.
  const p = { degrees: [{ label: 'MS', field: 'cs', graduates: '2027' }] };
  assert.equal(checkGraduation('graduating between May 2027 and August 2027', p.degrees).verdict, 'eligible');
});

test('a profile with no parseable graduation date is unknown, not ineligible', () => {
  // Falling through to the ineligible return dropped EVERY windowed posting for
  // a profile whose degrees block merely omits a date.
  const p = { degrees: [{ label: 'MS', field: 'ai for business', level: 'masters' }] };
  const r = eligibility('graduating between December 2027 and Summer 2028', p);
  assert.equal(r.verdict, 'unknown');
  assert.ok(!/undefined/.test(r.reason), 'the reason should not print "undefined"');
});

test('a floor written after the term is a floor, not a single date', () => {
  // "Graduation date of August 2027 or beyond" fell through to the single-term
  // branch and was read as August 2027 exactly, deleting a December 2027
  // graduate -- four COUNTRY Financial rows on one Chicago list.
  const dec27 = { degrees: [{ label: 'MS', field: 'cs', level: 'masters', graduates: 'December 2027' }] };
  for (const jd of ['Graduation date of August 2027 or beyond',
    'Graduating August 2027 and later',
    'Graduation date of August 2027 onwards',
    'Expected graduation August 2027 or after']) {
    assert.equal(eligibility(jd, dec27).verdict, 'eligible', jd);
  }
  assert.equal(parseGraduationWindow('Graduation date of August 2027 or beyond').kind, 'floor');
  assert.equal(parseGraduationWindow('Graduation date of August 2027 or beyond').to, null);
});

test('a ceiling written after the term is a ceiling', () => {
  const w = parseGraduationWindow('Graduating May 2026 or earlier');
  assert.equal(w.kind, 'ceiling');
  assert.equal(w.from, null);
});

test('a PREFERRED graduation date does not reject', () => {
  // "Be enrolled as a junior undergraduate (Preferred Graduation Date: Spring
  // 2028)" was read as a hard May-2028-only window. Only a confirmed mismatch
  // may reject, and a preference confirms nothing.
  for (const jd of ['Preferred Graduation Date: Spring 2028',
    'Ideally graduating in May 2028',
    'Graduation in May 2028 preferred']) {
    assert.equal(parseGraduationWindow(jd), null, jd);
  }
  // ...but the same sentence stated as a requirement still does.
  assert.equal(eligibility('Expecting to graduate in May 2028.', PROFILE).verdict, 'ineligible');
});

test('a junior undergraduate posting is undergraduate-only however it is phrased', () => {
  assert.equal(checkLevel('Be enrolled as a junior undergraduate', PROFILE.degrees).verdict, 'ineligible');
  assert.equal(checkLevel('open to undergraduate sophomores', PROFILE.degrees).verdict, 'ineligible');
  // Still not when graduate students are welcomed alongside.
  assert.equal(checkLevel('junior undergraduate or graduate student', PROFILE.degrees).verdict, 'unknown');
});
