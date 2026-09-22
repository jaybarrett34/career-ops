import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pearson, spearman, ranks, dropTail, robustCorrelation,
  monotonicity, claimsAvailable, correctedAlpha, countComparisons, unverifiedClaims,
} from '../lib/evidence.mjs';

test('the outlier case: a correlation carried by one point is called unstable', () => {
  // The shape that nearly shipped in the sibling project: Pearson positive and
  // convincing, Spearman flat or negative, sign flips when the tail is dropped.
  const pairs = [];
  for (let i = 0; i < 40; i++) pairs.push([i, -i * 0.01]);  // mild negative trend
  pairs.push([100, 100]);                                    // one leveraged point
  const r = robustCorrelation(pairs, { tailFrac: 0.05 });
  assert.ok(r.pearson > 0, 'the naive statistic looks positive');
  assert.ok(r.spearman < 0, 'the rank statistic disagrees');
  assert.equal(r.verdict, 'unstable');
  assert.match(r.reason, /carried by/);
});

test('a real relationship survives all three views', () => {
  const pairs = Array.from({ length: 50 }, (_, i) => [i, i * 2 + (i % 3)]);
  const r = robustCorrelation(pairs);
  assert.equal(r.verdict, 'consistent');
  assert.ok(r.pearson > 0.9 && r.spearman > 0.9 && r.pearsonDropTail > 0.9);
});

test('ranks average ties instead of inventing an order', () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('dropTail removes by magnitude of OUTCOME, not of input', () => {
  const pairs = [[0, 1], [1, 2], [2, 100], [3, 3]];
  const { kept, dropped } = dropTail(pairs, 0.25);
  assert.equal(dropped, 1);
  assert.ok(!kept.some((p) => p[1] === 100), 'the extreme outcome is what leaves');
});

test('too few observations refuses to produce a statistic at all', () => {
  assert.equal(robustCorrelation([[1, 1], [2, 2]]).verdict, 'too-few');
  assert.equal(robustCorrelation([]).verdict, 'too-few');
  assert.equal(pearson([[1, 1]]), null);
});

test('a constant series yields no correlation rather than NaN', () => {
  assert.equal(pearson([[1, 5], [2, 5], [3, 5]]), null);
});

test('monotonicity separates an ordered trend from one elevated cell', () => {
  assert.equal(monotonicity([0.52, 0.51, 0.50, 0.49, 0.48]).monotone, true);
  // Only the top bucket moves: one cell, not a trend.
  const spike = monotonicity([0.10, 0.10, 0.10, 0.10, 0.40]);
  assert.equal(spike.monotone, false);
  assert.match(spike.reason, /reverse direction/);
});

test('a four-row tracker is told it can falsify but not estimate', () => {
  // The honest framing for this pipeline's actual sample size.
  const four = claimsAvailable(4);
  assert.equal(four.canEstimate, false);
  assert.equal(four.canFalsify, false);
  assert.match(four.guidance, /artifact of the denominator/);

  const eight = claimsAvailable(8);
  assert.equal(eight.canEstimate, false);
  assert.equal(eight.canFalsify, true);
  assert.match(eight.guidance, /smoke test/);
});

test('a large sample reports what size of difference it can detect', () => {
  const big = claimsAvailable(500);
  assert.equal(big.canEstimate, true);
  assert.ok(big.detectable < 0.05);
});

test('the comparison budget tightens the bar as tests accumulate', () => {
  // 29 tests was where the sibling project landed; its best p=0.0050 did not clear.
  const { corrected } = correctedAlpha(29);
  assert.ok(Math.abs(corrected - 0.05 / 29) < 1e-12);
  assert.ok(0.0050 > corrected, 'a nominally significant result fails the corrected bar');
  assert.equal(correctedAlpha(0).comparisons, 1, 'never divides by zero');
});

test('the budget ledger counts entries, not comments or the header', () => {
  const tsv = ['# comparisons made against outcome data', 'date\twhat\tnote',
    '2026-09-21\tscore vs response\t', '2026-09-22\tats vs advance\t'].join('\n');
  assert.equal(countComparisons(tsv), 2);
  assert.equal(countComparisons(''), 0);
});

test('a figure without a verified stamp is reported; a stamped one is not', () => {
  const bullets = [
    { id: 'a', org: 'Acme', text: 'Built six pipelines across five repositories' },
    { id: 'b', org: 'Acme', text: 'Cut latency by 60%', verified: '2026-09-22 user-stated' },
    { id: 'c', org: 'Acme', text: 'Shipped the migration' },
  ];
  const u = unverifiedClaims(bullets);
  assert.deepEqual(u.map((x) => x.id), ['a']);
});

test('a bare year is not a quantified claim', () => {
  // "Summer 2027" and "Python 3.13" must not demand confirmation; they are not
  // assertions about scale or outcome.
  assert.deepEqual(unverifiedClaims([{ id: 'y', org: 'A', text: 'Interned in 2026' }]), []);
});

test('the real library has no unstamped figures', async () => {
  // The regression this guards: a count master itself flagged UNVERIFIED shipped
  // on resumes for weeks, because nothing computed it and nothing could fail.
  const fs = await import('node:fs');
  const yaml = await import('js-yaml');
  const { validateLibrary } = await import('../lib/bullets.mjs');
  const path = new URL('../config/bullets.yml', import.meta.url).pathname;
  if (!fs.existsSync(path)) return; // user-layer file, absent in a bare checkout
  const lib = validateLibrary(yaml.load(fs.readFileSync(path, 'utf8'))).bullets;
  const u = unverifiedClaims(lib);
  assert.deepEqual(u.map((c) => `${c.org}: ${c.figure}`), [],
    'every figure on a resume must carry a verified stamp');
});
