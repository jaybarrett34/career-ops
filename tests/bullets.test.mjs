import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, groupVariants, slugId, validateLibrary, selectBullets, scoreAgainstKeywords, checkAuthorship } from '../lib/bullets.mjs';

test('similarity ignores latex wrappers and punctuation', () => {
  assert.ok(similarity('\\textbf{Built} a pipeline', 'Built a pipeline') > 0.9);
});

test('restatements of one fact group together', () => {
  const g = groupVariants([
    { org: 'X', text: 'Selected from a 500-person cohort into an 80-100 person program on engineering judgment' },
    { org: 'X', text: 'Selected from a 500-person cohort into an 80-100 person program on evaluation quality' },
  ], 0.48);
  assert.equal(g.length, 1);
});

test('different facts from the same employer stay separate', () => {
  const g = groupVariants([
    { org: 'X', text: 'Built six CI/CD pipelines across five repositories' },
    { org: 'X', text: 'Ported a 1500-line Scheme utility to modular Python' },
  ], 0.48);
  assert.equal(g.length, 2);
});

test('identical text from different employers never merges', () => {
  const g = groupVariants([
    { org: 'A', text: 'Built a data pipeline in Python' },
    { org: 'B', text: 'Built a data pipeline in Python' },
  ], 0.48);
  assert.equal(g.length, 2);
});

test('canonical is the longest variant', () => {
  const g = groupVariants([
    { org: 'X', text: 'Built a pipeline' },
    { org: 'X', text: 'Built a pipeline in Python with tests and docs' },
  ], 0.3);
  assert.match(g[0].canonical.text, /tests and docs/);
});

test('ids are unique and path-safe', () => {
  const taken = new Set();
  const a = slugId('Intel Corporation', 'Built six CI CD pipelines', taken);
  const b = slugId('Intel Corporation', 'Built six CI CD pipelines', taken);
  assert.notEqual(a, b);
  for (const id of [a, b]) assert.match(id, /^[a-z0-9][a-z0-9-]*$/);
});

test('validation rejects bad entries without losing good ones', () => {
  const r = validateLibrary({ bullets: [
    { id: 'ok', text: 'a real bullet', org: 'X' },
    { id: '../evil', text: 'x' },
    { id: 'ok', text: 'dup' },
    { id: 'nostring' },
  ] });
  assert.deepEqual(r.bullets.map((b) => b.id), ['ok']);
  assert.equal(r.errors.length, 3);
});

test('selection reports missing ids rather than silently dropping them', () => {
  const lib = validateLibrary({ bullets: [{ id: 'a', text: 'alpha', short: 'al' }] }).bullets;
  const s = selectBullets(lib, ['a', 'nope']);
  assert.equal(s.picked.length, 1);
  assert.deepEqual(s.missing, ['nope']);
});

test('short variant is used only when asked for and present', () => {
  const lib = validateLibrary({ bullets: [
    { id: 'a', text: 'long form', short: 'short form' },
    { id: 'b', text: 'no short here' },
  ] }).bullets;
  assert.equal(selectBullets(lib, ['a'], { preferShort: true }).picked[0].rendered, 'short form');
  assert.equal(selectBullets(lib, ['a']).picked[0].rendered, 'long form');
  assert.equal(selectBullets(lib, ['b'], { preferShort: true }).picked[0].rendered, 'no short here');
});

test('keyword scoring counts distinct hits across text and tags', () => {
  const b = { text: 'Built Jenkins pipelines in Python', short: null, tags: ['ci'] };
  assert.equal(scoreAgainstKeywords(b, ['jenkins', 'python', 'ci']), 3);
  assert.equal(scoreAgainstKeywords(b, ['kubernetes']), 0);
  assert.equal(scoreAgainstKeywords(b, []), 0);
});

test('an authorship verb on a role that did not author is refused', () => {
  // The fabrication this catches is tool-of-trade conflation, and it is most
  // tempting exactly where the best numbers live -- an evaluation role with
  // volume metrics. Rule 22 in master said "do not do this"; prose does not
  // enforce, so the check does.
  const bad = checkAuthorship(
    [{ id: 'x', org: 'Alignerr', text: 'Built CLI tooling across 20+ repos', short: null }],
    { Alignerr: { reason: 'specified and evaluated' } },
  );
  assert.equal(bad.length, 1);
  assert.match(bad[0], /"Built" claims authorship/);
});

test('the permitted framing passes', () => {
  const ok = checkAuthorship(
    [{ id: 'x', org: 'Alignerr', text: 'Specified and evaluated CLI tooling', short: null },
     { id: 'y', org: 'Alignerr', text: 'Steered pre-release models to a PR-ready bar', short: null }],
    { Alignerr: { reason: 'specified and evaluated' } },
  );
  assert.deepEqual(ok, []);
});

test('the limit is per-org, never global', () => {
  // Intel is where he DID build; the check must not disarm his strongest verbs.
  const ok = checkAuthorship(
    [{ id: 'i', org: 'Intel Corporation', text: 'Built six CI/CD pipelines', short: null }],
    { Alignerr: { reason: 'specified and evaluated' } },
  );
  assert.deepEqual(ok, []);
});

test('the short variant is checked too', () => {
  // A long form can be careful while the short form someone wrote later is not,
  // and the short form is what ships when the page overflows.
  const bad = checkAuthorship(
    [{ id: 'x', org: 'Alignerr', text: 'Specified and evaluated tooling', short: 'Built the tooling' }],
    { Alignerr: { reason: 'specified and evaluated' } },
  );
  assert.equal(bad.length, 1);
});

test('an org may allow a specific verb', () => {
  const ok = checkAuthorship(
    [{ id: 'x', org: 'Alignerr', text: 'Designed the evaluation rubric', short: null }],
    { Alignerr: { reason: 'specified and evaluated', allow: ['designed'] } },
  );
  assert.deepEqual(ok, []);
});

test('no limits declared means no check', () => {
  assert.deepEqual(checkAuthorship([{ id: 'x', org: 'Anywhere', text: 'Built it', short: null }], undefined), []);
});
