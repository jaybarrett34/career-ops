import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, companyKey, isSharedHost, normalizeDiscovered, mergeDiscoveries, toYaml, promotionCandidates } from '../lib/discovered.mjs';

test('hosts normalize, www is dropped, junk yields empty', () => {
  assert.equal(hostOf('https://www.Optiver.com/jobs/1'), 'optiver.com');
  assert.equal(hostOf('http://boards.greenhouse.io/x'), 'boards.greenhouse.io');
  assert.equal(hostOf('not a url'), '');
  assert.equal(hostOf(null), '');
});

test('company keys ignore suffixes and punctuation so one firm is one entry', () => {
  assert.equal(companyKey('Acme, Inc.'), companyKey('ACME LLC'));
  assert.equal(companyKey('Hudson River Trading'), companyKey('hudson-river trading'));
  assert.notEqual(companyKey('Optiver'), companyKey('Optiver Services'));
});

test('a company already tracked in portals.yml is never recorded', () => {
  const known = new Set([companyKey('Optiver')]);
  const { merged, added } = mergeDiscoveries(new Map(), [{ company: 'Optiver, Inc.', url: 'https://optiver.com/j/1' }],
    { known, today: '2026-09-14', source: 'simplify' });
  assert.equal(added, 0);
  assert.equal(merged.size, 0);
});

test('a shared ATS host never merges two employers', () => {
  // Two postings on boards.greenhouse.io say nothing about whether they are the
  // same company.
  const m = mergeDiscoveries(new Map(), [
    { company: 'Alpha', url: 'https://boards.greenhouse.io/alpha/1' },
    { company: 'Beta', url: 'https://boards.greenhouse.io/beta/1' },
  ], { today: 'd' }).merged;
  assert.equal(m.size, 2);
});

test('a shared OWN host merges two spellings of one employer', () => {
  const m = mergeDiscoveries(new Map(), [
    { company: 'Akuna', url: 'https://akunacapital.com/a' },
    { company: 'Akuna Capital University', url: 'https://akunacapital.com/b' },
  ], { today: 'd' }).merged;
  assert.equal(m.size, 1);
  assert.equal([...m.values()][0].count, 2);
});

test('counts accumulate across runs rather than resetting', () => {
  const day1 = mergeDiscoveries(new Map(), [{ company: 'Akuna', url: 'https://akunacapital.com/a' }],
    { today: '2026-09-01', source: 'simplify' });
  const day2 = mergeDiscoveries(day1.merged, [{ company: 'Akuna, Inc.', url: 'https://akunacapital.com/b' }],
    { today: '2026-09-14', source: 'simplify' });
  const e = [...day2.merged.values()][0];
  assert.equal(e.count, 2);
  assert.equal(e.firstSeen, '2026-09-01');
  assert.equal(e.lastSeen, '2026-09-14');
  assert.equal(day2.added, 0);
  assert.equal(day2.updated, 1);
});

test('the display name from first sighting is kept, not overwritten', () => {
  const a = mergeDiscoveries(new Map(), [{ company: 'Akuna Capital', url: 'x' }], { today: 'd1' });
  const b = mergeDiscoveries(a.merged, [{ company: 'AKUNA CAPITAL LLC', url: 'x' }], { today: 'd2' });
  assert.equal([...b.merged.values()][0].company, 'Akuna Capital');
});

test('distinct hosts and sources accumulate without duplicates', () => {
  let m = new Map();
  m = mergeDiscoveries(m, [{ company: 'X', url: 'https://a.com/1' }], { today: 'd', source: 'simplify' }).merged;
  m = mergeDiscoveries(m, [{ company: 'X', url: 'https://b.com/1' }], { today: 'd', source: 'greenhouse' }).merged;
  m = mergeDiscoveries(m, [{ company: 'X', url: 'https://a.com/2' }], { today: 'd', source: 'simplify' }).merged;
  const e = [...m.values()][0];
  assert.deepEqual(e.hosts.sort(), ['a.com', 'b.com']);
  assert.deepEqual(e.sources.sort(), ['greenhouse', 'simplify']);
});

test('nameless or malformed hits are skipped without throwing', () => {
  const { merged } = mergeDiscoveries(new Map(), [null, {}, { company: '   ' }, { company: 'Real', url: 'https://r.com' }],
    { today: 'd' });
  assert.equal(merged.size, 1);
});

test('yaml round-trips through the normalizer', () => {
  const m = mergeDiscoveries(new Map(), [{ company: 'Quote "Co" \\ Ltd', url: 'https://q.com/1' }],
    { today: '2026-09-14', source: 's' }).merged;
  const back = normalizeDiscovered({ discovered: [...m.values()].map((r) => ({
    company: r.company, hosts: r.hosts, sources: r.sources, count: r.count,
    first_seen: r.firstSeen, last_seen: r.lastSeen })) });
  assert.equal([...back.values()][0].company, 'Quote "Co" \\ Ltd');
  assert.ok(toYaml(m).includes('discovered:'));
});

test('promotion candidates need repeat sightings and exclude promoted ones', () => {
  const m = normalizeDiscovered({ discovered: [
    { company: 'Once', count: 1 },
    { company: 'Twice', count: 2 },
    { company: 'Already', count: 9, promoted: true },
  ] });
  assert.deepEqual(promotionCandidates(m).map((r) => r.company), ['Twice']);
});

test('workday and icims tenants are treated as shared', () => {
  assert.equal(isSharedHost('acme.wd5.myworkdayjobs.com'), true);
  assert.equal(isSharedHost('careersus-shure.icims.com'), true);
  assert.equal(isSharedHost('optiver.com'), false);
  assert.equal(isSharedHost(''), true);
});

test('garbage input normalizes to an empty map rather than throwing', () => {
  for (const j of [null, undefined, 42, 'str', { discovered: 'no' }])
    assert.equal(normalizeDiscovered(j).size, 0);
});
