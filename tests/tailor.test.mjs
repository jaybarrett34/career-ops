import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  covers, bulletCoverage, setCoverage, variantGroup, chooseByCoverage,
  tailorResume, resumeVocabulary, keywordsFromJd, hasOutcome, outcomeDensity,
} from '../lib/tailor.mjs';

const b = (id, org, text, extra = {}) => ({ id, org, text, tags: [], ...extra });

test('matching respects word boundaries', () => {
  // Both of these longer words are on the real resume, so substring matching
  // reports a keyword as covered that the resume never claims.
  assert.equal(covers('I write JavaScript', 'Java'), false);
  assert.equal(covers('built in Java 21', 'Java'), true);
  assert.equal(covers('interned at Google', 'Go'), false);
  // Phrases and punctuated terms match as written; a boundary rule breaks them.
  assert.equal(covers('wired CI/CD pipelines', 'CI/CD'), true);
  assert.equal(covers('practised test-driven development', 'Test-Driven Development'), true);
});

test('the vocabulary is the user\'s own material, not the posting\'s words', () => {
  // The first attempt ran a generic skill extractor over the JD and returned
  // "December", "Lunch", "GPA" and "Chicago" as skills.
  const lib = [b('x', 'Acme', 'Shipped a pipeline on Apache Kafka into Elasticsearch')];
  const vocab = resumeVocabulary(lib, '\\textbf{Languages:} Python, SQL \\\\');
  assert.ok(vocab.includes('Python'));
  assert.ok(vocab.includes('SQL'));
  assert.ok(vocab.some((t) => t.includes('Kafka')));
  assert.ok(!vocab.includes('December'));
  // Sentence-initial verbs are not skills.
  assert.ok(!vocab.includes('Shipped'));
});

test('keywords are the intersection of the vocabulary and the posting', () => {
  const vocab = ['Python', 'Kafka', 'Rust'];
  const kw = keywordsFromJd(vocab, 'We use Python and Kafka daily. No Go here.');
  assert.deepEqual(kw.sort(), ['Kafka', 'Python']);
  assert.ok(!kw.includes('Rust'), 'a term the posting never asks for is not a keyword');
});

test('a term contained in a longer matched term is not counted twice', () => {
  const kw = keywordsFromJd(['Git', 'GitHub Actions'], 'we use GitHub Actions');
  assert.deepEqual(kw, ['GitHub Actions']);
});

test('variantGroup reads both spellings of variant_of', () => {
  // config/bullets.yml writes variant_of; validateLibrary normalizes it to
  // variantOf. Reading only one made every validated bullet its own group, and
  // the tailor put two phrasings of one pipeline on the same page.
  assert.equal(variantGroup({ id: 'a', variant_of: 'base' }), 'base');
  assert.equal(variantGroup({ id: 'a', variantOf: 'base' }), 'base');
  assert.equal(variantGroup({ id: 'a' }), 'a');
});

test('two phrasings of one fact never both get chosen', () => {
  const lib = [
    b('base', 'Acme', 'Shipped a Python pipeline'),
    b('alt', 'Acme', 'Shipped a Python pipeline with Docker', { variantOf: 'base' }),
    b('other', 'Acme', 'Ran Kafka in production'),
  ];
  const got = chooseByCoverage(lib, ['Python', 'Docker', 'Kafka'], 2);
  assert.equal(got.length, 2);
  const groups = got.map(variantGroup);
  assert.equal(new Set(groups).size, 2, 'both picks must state different facts');
});

test('set cover beats per-bullet ranking', () => {
  // Ranking by per-bullet hit count picks the two Python bullets (2 hits each)
  // and drops the only line that mentions Kafka.
  const lib = [
    b('p1', 'Acme', 'Built Python services with CI/CD'),
    b('p2', 'Acme', 'More Python work, more CI/CD'),
    b('k1', 'Acme', 'Ran Kafka in production'),
  ];
  const got = chooseByCoverage(lib, ['Python', 'CI/CD', 'Kafka'], 2);
  assert.deepEqual([...setCoverage(got, ['Python', 'CI/CD', 'Kafka'])].sort(), ['CI/CD', 'Kafka', 'Python']);
});

test('an incumbent wins a tie, so nothing churns for no gain', () => {
  // It reported "before 5/8 -> after 5/8" while swapping six lines: churn
  // presented as optimization, discarding phrasing the user may have chosen.
  const lib = [
    b('sitting', 'Acme', 'Built Python services'),
    b('challenger', 'Acme', 'Also built Python services'),
  ];
  const incumbents = [lib[0]];
  const got = chooseByCoverage(lib, ['Python'], 1, { incumbents });
  assert.equal(got[0].id, 'sitting');
});

test('a better-covering sibling still displaces the incumbent', () => {
  // The tie-break must not freeze a worse bullet in place.
  const lib = [
    b('sitting', 'Acme', 'Built Python services'),
    b('better', 'Acme', 'Built Python services on Azure DevOps'),
  ];
  const got = chooseByCoverage(lib, ['Python', 'Azure DevOps'], 1, { incumbents: [lib[0]] });
  assert.equal(got[0].id, 'better');
});

test('slots stay with their own employer', () => {
  // A Kyndryl bullet cannot fill an Intel slot; the .tex places each under its
  // employer heading, so rebalancing across orgs would move a line between jobs.
  const lib = [
    b('i1', 'Intel', 'Wrote Ruby'), b('i2', 'Intel', 'Wrote more Ruby'),
    b('k1', 'Kyndryl', 'Built Python and Kafka'), b('k2', 'Kyndryl', 'Built Python'),
  ];
  const r = tailorResume(lib, ['i1', 'k1'], ['Python', 'Kafka']);
  const orgs = r.ids.map((id) => lib.find((x) => x.id === id).org);
  assert.deepEqual(orgs, ['Intel', 'Kyndryl'], 'one slot each, in the original order');
});

test('a term no bullet covers is reported, never filled', () => {
  const lib = [b('x', 'Acme', 'Built Python services')];
  const r = tailorResume(lib, ['x'], ['Python', 'Haskell']);
  assert.deepEqual(r.unclaimable, ['Haskell']);
  assert.equal(r.ids.length, 1, 'no bullet is invented to cover the gap');
});

test('a bullet covering nothing is NOT dropped just to raise keyword density', () => {
  // The tempting move is to swap the documentation bullet for a second Python
  // one: mentions go up, unique coverage does not. That is the over-optimization
  // that makes a resume worse -- it discards a line the user chose, which may be
  // their strongest achievement, in exchange for repeating a word. Density is
  // reported; it is never bought by dropping an incumbent.
  const lib = [
    b('a', 'Acme', 'Built Python services'),
    b('b', 'Acme', 'Shipped Python tooling'),
    b('c', 'Acme', 'Wrote documentation'),
  ];
  const r = tailorResume(lib, ['a', 'c'], ['Python']);
  assert.deepEqual(r.ids.sort(), ['a', 'c']);
  assert.equal(r.coveredAfter.length, 1);
  assert.equal(r.changed, false);
});

test('unique coverage and total mentions are reported separately', () => {
  // They answer different questions: unique is what a reader sees, mentions is
  // closer to keyword-weighted ATS scoring. A swap often moves only the second,
  // which is why reporting only unique coverage made real swaps look pointless.
  const lib = [
    b('a', 'Acme', 'Built Python services'),
    b('weak', 'Acme', 'Did some work'),
    b('strong', 'Acme', 'Shipped Python on Azure DevOps'),
  ];
  const r = tailorResume(lib, ['a', 'weak'], ['Python', 'Azure DevOps']);
  assert.ok(r.coveredAfter.length > r.coveredBefore.length, 'a real unique gain drives the swap');
  assert.ok(r.mentionsAfter > r.mentionsBefore, 'and mentions rise with it');
});

test('an outcome clause is detected across the forms his bullets actually use', () => {
  // The first detector matched "cutting" but not "cut" and called a good bullet
  // outcome-free. A detector that misfires on real material argues for edits
  // that make the page weaker, so the verb forms are pinned here.
  for (const t of [
    'Modernized the export so consumers migrated without a break',
    'Standardized workflows to cut token spend on boilerplate prototyping',
    'Containerized the stack, eliminating configuration drift',
    'Rewrote the path in Python, emitting identical YAML so no downstream consumer had to change',
    'Led a 4-person team yielding a 60% speed-up',
    'Built six CI/CD pipelines, designing failure-path tests that surfaced a routing bug',
    'iterating candidate outputs to a PR-ready bar',
  ]) assert.equal(hasOutcome({ text: t }), true, t);
});

test('a bullet that only names the work has no outcome', () => {
  for (const t of [
    'Shipped a Python producer-consumer pipeline streaming ServiceNow data through Kafka',
    'Coursework: Operating Systems, Analysis of Algorithms, Discrete Mathematics',
    'Served as senior reviewer on a late-phase code evaluation project',
    // Spelled-out counts are not outcomes: "six pipelines across five repos"
    // says how much work, never what the work produced.
    'Built six CI/CD pipelines across five repositories',
  ]) assert.equal(hasOutcome({ text: t }), false, t);
});

test('the short variant counts, since it is what ships on an overflowing page', () => {
  assert.equal(hasOutcome({ text: 'Did the work', short: 'Did the work, cutting spend' }), true);
});

test('a swap that trades an outcome for keywords is named, not buried', () => {
  // The exact failure the governing principle warns about: the page gains
  // keywords and loses the reason a human believes the claim.
  const lib = [
    { id: 'rich', org: 'Acme', text: 'Built the thing so the team shipped weekly', tags: [] },
    { id: 'dense', org: 'Acme', text: 'Built with Python, Kafka, Docker and Terraform', tags: [] },
  ];
  const r = tailorResume(lib, ['rich'], ['Python', 'Kafka', 'Docker', 'Terraform']);
  assert.deepEqual(r.ids, ['dense'], 'coverage still drives the swap');
  assert.deepEqual(r.outcomeLost, ['rich'], 'and the cost is reported');
  assert.equal(r.outcomeAfter.withOutcome, 0);
});

test('a swap that keeps the outcome reports no loss', () => {
  const lib = [
    { id: 'a', org: 'Acme', text: 'Built it so the team shipped weekly', tags: [] },
    { id: 'b', org: 'Acme', text: 'Built it with Python so latency dropped', tags: [] },
  ];
  const r = tailorResume(lib, ['a'], ['Python']);
  assert.deepEqual(r.outcomeLost, []);
});
