import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTerm, parseGraduationWindow, claimableFields, checkGraduation, checkLevel, eligibility,
} from '../lib/eligibility.mjs';

// Jay's actual degrees — the cases below are the real postings this was built from.
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
