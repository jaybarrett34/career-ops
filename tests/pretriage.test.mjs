import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, dedupKey, score, isEarlyCareer, domainKeywords, EARLY_CAREER_KEYWORDS, pretriage } from '../pretriage.mjs';

const NEAR = ['chicago', 'tucson', 'phoenix', 'arizona', 'illinois'];
let seq = 0;
const row = (o) => ({ index: seq++, done: false, url: 'https://x.test/1', company: '', title: '', location: '', postedAt: '', ...o });

test('the same URL written twice keeps two separate decisions', () => {
  // pipeline.md really does hold 41 duplicated URLs. Keyed by URL, a rejected
  // copy's verdict lands on the shortlisted copy and silently retires it.
  const a = row({ url: 'https://same.test/1', company: 'Acme', title: 'Software Engineer Intern', location: 'Chicago, IL' });
  const b = row({ url: 'https://same.test/1', company: 'Acme', title: 'Preconstruction Intern', location: 'Chicago, IL' });
  const { shortlist, reasons } = pretriage([a, b], {
    near: NEAR, keep: 10, domain: (t) => /software/i.test(t), domainOnly: true,
  });
  assert.equal(shortlist.length, 1);
  assert.equal(shortlist[0].index, a.index);
  assert.equal(reasons.has(a.index), false, 'the surviving row must carry no verdict');
  assert.equal(reasons.get(b.index), 'off-domain title');
});

test('a pipeline row parses into its fields', () => {
  const r = parseRow('- [ ] https://acme.test/1 | Acme | Software Engineer Intern | Chicago, IL | posted: 2026-09-01 | sponsorship: Other');
  assert.equal(r.done, false);
  assert.equal(r.company, 'Acme');
  assert.equal(r.title, 'Software Engineer Intern');
  assert.equal(r.location, 'Chicago, IL');
  assert.equal(r.postedAt, '2026-09-01');
});

test('labeled segments are never mistaken for the location', () => {
  // The scanners append posted: and sponsorship: in no fixed order, so the
  // location cannot be read positionally.
  const r = parseRow('- [ ] https://acme.test/1 | Acme | SWE Intern | posted: 2026-09-01 | Chicago, IL');
  assert.equal(r.location, 'Chicago, IL');
});

test('non-rows and malformed rows are skipped, not guessed at', () => {
  assert.equal(parseRow('## Pipeline'), null);
  assert.equal(parseRow('- [ ] not-a-url | Acme | SWE'), null);
  assert.equal(parseRow(''), null);
});

test('one requisition on two of an employer\'s own tenants is one opening', () => {
  // Boeing publishes a single JR number on both its EXTERNAL_CAREERS and INTERN
  // Workday sites; URL equality sees two jobs.
  const a = row({ company: 'The Boeing Company', title: 'Data Analytics Intern' });
  const b = row({ company: 'The Boeing Company', title: 'Data Analytics Intern' });
  assert.equal(dedupKey(a), dedupKey(b));
});

test('two scanners spelling one employer differently is one opening', () => {
  const a = row({ company: 'Akuna Capital', title: 'Software Engineer Intern - Python' });
  const b = row({ company: 'akunacapital', title: 'Software Engineer Intern  Python' });
  assert.equal(dedupKey(a), dedupKey(b));
});

test('the year is not part of the identity but the role is', () => {
  assert.equal(
    dedupKey(row({ company: 'Acme', title: 'SWE Intern - Summer 2027' })),
    dedupKey(row({ company: 'Acme', title: 'SWE Intern' })),
  );
  assert.notEqual(
    dedupKey(row({ company: 'Acme', title: 'SWE Intern' })),
    dedupKey(row({ company: 'Acme', title: 'Data Intern' })),
  );
});

test('isEarlyCareer accepts the forms these feeds actually use', () => {
  for (const t of ['Software Engineer Intern', 'Summer Internship 2027', 'Engineering Co-op',
    'Coop Software Developer', 'New Grad Software Engineer', 'Campus Hire - Technology',
    'Summer Analyst, Technology', 'Early Career Engineer']) {
    assert.equal(isEarlyCareer(t), true, t);
  }
  for (const t of ['Software Engineer', 'Senior Data Engineer', 'Internal Auditor', 'International Analyst']) {
    assert.equal(isEarlyCareer(t), false, t);
  }
});

test('a wrong-term posting loses to a right-term one regardless of recency', () => {
  // The bug this pins: ranking on location and freshness alone put "Founding
  // Product FullStack Engineer (Remote)" above a Chicago internship.
  const fullTimeFresh = row({ title: 'Founding Product FullStack Engineer', location: 'Remote', postedAt: '2026-09-14' });
  const internOld = row({ title: 'Software Engineer Intern', location: 'Chicago, IL', postedAt: '2026-07-01' });
  assert.ok(score(internOld, { near: NEAR }) > score(fullTimeFresh, { near: NEAR }));
});

test('remote counts only when it is not somewhere else', () => {
  const usRemote = row({ title: 'SWE Intern', location: 'Remote in USA', postedAt: '2026-09-01' });
  const ukRemote = row({ title: 'SWE Intern', location: 'Remote UK', postedAt: '2026-09-01' });
  const latam = row({ title: 'SWE Intern', location: 'Colombia - Remote', postedAt: '2026-09-01' });
  assert.ok(score(usRemote, { near: NEAR }) > score(ukRemote, { near: NEAR }));
  assert.ok(score(usRemote, { near: NEAR }) > score(latam, { near: NEAR }));
});

test('a near location beats remote', () => {
  const near = row({ title: 'SWE Intern', location: 'Chicago, IL', postedAt: '2026-09-01' });
  const remote = row({ title: 'SWE Intern', location: 'Remote in USA', postedAt: '2026-09-01' });
  assert.ok(score(near, { near: NEAR }) > score(remote, { near: NEAR }));
});

test('an on-domain intern outranks an off-domain one in the same city', () => {
  const domain = (t) => /software|engineer|data/i.test(t);
  const swe = row({ title: 'Software Engineer Intern', location: 'Chicago, IL', postedAt: '2026-09-01' });
  const precon = row({ title: 'Preconstruction Intern', location: 'Chicago, IL', postedAt: '2026-09-01' });
  assert.ok(score(swe, { near: NEAR, domain }) > score(precon, { near: NEAR, domain }));
});

test('domainKeywords drops the catch-alls and keeps the domain terms', () => {
  const kws = domainKeywords({ positive: ['Software Engineer', 'word:Intern', 'Internship', 'Data Engineer', 'Summer 2027'] });
  assert.deepEqual(kws, ['Software Engineer', 'Data Engineer']);
  // And the constant is what drives it, so the two cannot drift apart.
  assert.ok(EARLY_CAREER_KEYWORDS.has('word:intern'));
});

test('dedup keeps the better copy, never the first one seen', () => {
  const rows = [
    row({ url: 'https://a.test/worse', company: 'Acme', title: 'SWE Intern', location: 'Remote in USA', postedAt: '2026-09-01' }),
    row({ url: 'https://a.test/better', company: 'Acme', title: 'SWE Intern', location: 'Chicago, IL', postedAt: '2026-09-01' }),
  ];
  const { shortlist, reasons } = pretriage(rows, { near: NEAR, keep: 10 });
  assert.equal(shortlist.length, 1);
  assert.equal(shortlist[0].url, 'https://a.test/better');
  assert.equal(reasons.get(rows[0].index), 'duplicate opening');
});

test('rows already done are left alone', () => {
  const rows = [row({ done: true, url: 'https://a.test/done', title: 'SWE Intern' })];
  const { shortlist, reasons } = pretriage(rows, { near: NEAR, keep: 10 });
  assert.equal(shortlist.length, 0);
  assert.equal(reasons.size, 0, 'an already-triaged row must not be re-annotated');
});

test('every row that does not survive carries a reason', () => {
  const rows = [
    row({ url: 'https://a.test/1', company: 'Acme', title: 'SWE Intern', location: 'Chicago, IL' }),
    row({ url: 'https://a.test/2', company: 'Acme', title: 'Preconstruction Intern', location: 'Chicago, IL' }),
    row({ url: 'https://a.test/3', company: 'Beta', title: 'Senior Architect', location: 'Chicago, IL' }),
  ];
  const { shortlist, reasons } = pretriage(rows, {
    near: NEAR, keep: 10, earlyCareerOnly: true,
    domain: (t) => /software|engineer/i.test(t), domainOnly: true,
  });
  const kept = new Set(shortlist.map((r) => r.index));
  for (const r of rows) {
    assert.ok(kept.has(r.index) || reasons.has(r.index), `${r.url} vanished without a reason`);
  }
  assert.equal(reasons.get(rows[1].index), 'off-domain title');
  assert.equal(reasons.get(rows[2].index), 'not an early-career posting');
});

test('reopen restores only the rows this tool retired', () => {
  // The first run's weights would otherwise be permanent, and a row the user
  // checked off by hand must never be un-checked.
  const REOPEN = /^- \[x\] (.*?) \| pretriage: [^\n]*$/gm;
  const before = [
    '- [x] https://a.test/1 | Acme | SWE Intern | Chicago, IL | pretriage: below the shortlist cut',
    '- [x] https://a.test/2 | Beta | SWE Intern | Chicago, IL',
    '- [ ] https://a.test/3 | Gamma | SWE Intern | Chicago, IL',
  ].join('\n');
  const after = before.replace(REOPEN, '- [ ] $1').split('\n');
  assert.equal(after[0], '- [ ] https://a.test/1 | Acme | SWE Intern | Chicago, IL');
  assert.equal(after[1], '- [x] https://a.test/2 | Beta | SWE Intern | Chicago, IL', 'a hand-checked row must survive');
  assert.equal(after[2], '- [ ] https://a.test/3 | Gamma | SWE Intern | Chicago, IL');
});
