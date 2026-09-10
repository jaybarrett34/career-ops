import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepListing, locationText, LISTS } from '../scan-simplify.mjs';

const DAY = 86400_000;
const nowSec = () => Math.floor(Date.now() / 1000);
const base = (over = {}) => ({
  active: true, is_visible: true, title: 'Software Engineer Intern',
  url: 'https://example.com/job/1', terms: ['Summer 2027'],
  date_posted: nowSec(), locations: ['Chicago, IL'], company_name: 'Acme', ...over,
});
const opts = (over = {}) => ({ term: /summer\s*2027/i, titleFilter: null, locationFilter: null, cutoffMs: null, includeInactive: false, ...over });

test('a well-formed active listing is kept', () => {
  assert.equal(keepListing(base(), opts()), true);
});

test('closed listings are dropped unless explicitly included', () => {
  assert.equal(keepListing(base({ active: false }), opts()), false);
  assert.equal(keepListing(base({ active: false }), opts({ includeInactive: true })), true);
});

test('is_visible false is always dropped', () => {
  assert.equal(keepListing(base({ is_visible: false }), opts()), false);
});

test('the TERM scopes the year, not the repo name', () => {
  // The Summer2027 repo carries Summer 2026 and Fall 2026 listings too, so
  // without this the "2027" list would return mostly 2026 roles.
  assert.equal(keepListing(base({ terms: ['Summer 2026'] }), opts()), false);
  assert.equal(keepListing(base({ terms: ['Fall 2026', 'Summer 2027'] }), opts()), true);
});

test('a list with no term (new grad) accepts any terms', () => {
  assert.equal(keepListing(base({ terms: [] }), opts({ term: null })), true);
});

test('junk is rejected without throwing', () => {
  for (const j of [null, undefined, 42, 'str', []]) assert.equal(keepListing(j, opts()), false);
  assert.equal(keepListing(base({ url: 'javascript:alert(1)' }), opts()), false, 'non-http url must be refused');
  assert.equal(keepListing(base({ url: 'ftp://x/y' }), opts()), false);
  assert.equal(keepListing(base({ title: '' }), opts()), false);
});

test('an UNDATED posting survives the age window rather than vanishing', () => {
  // The window is a relevance heuristic. Dropping undated rows would hide real
  // roles with no signal that it happened.
  const cutoffMs = Date.now() - 7 * DAY;
  assert.equal(keepListing(base({ date_posted: 0 }), opts({ cutoffMs })), true);
  assert.equal(keepListing(base({ date_posted: 'garbage' }), opts({ cutoffMs })), true);
  // A genuinely old one is dropped.
  assert.equal(keepListing(base({ date_posted: Math.floor((Date.now() - 90 * DAY) / 1000) }), opts({ cutoffMs })), false);
});

test('the shared title and location filters are actually applied', () => {
  const titleFilter = (t) => /engineer/i.test(t);
  const locationFilter = (l) => /chicago/i.test(l);
  assert.equal(keepListing(base({ title: 'Marketing Intern' }), opts({ titleFilter })), false);
  assert.equal(keepListing(base({ locations: ['Austin, TX'] }), opts({ locationFilter })), false);
  assert.equal(keepListing(base(), opts({ titleFilter, locationFilter })), true);
});

test('locations normalize from array, string, or missing', () => {
  assert.equal(locationText({ locations: ['A', 'B'] }), 'A · B');
  assert.equal(locationText({ locations: 'Solo' }), 'Solo');
  assert.equal(locationText({}), '');
  assert.equal(locationText({ locations: [1, 'Real', null] }), 'Real');
});

test('every configured list has the fields the scanner reads', () => {
  for (const [k, v] of Object.entries(LISTS)) {
    assert.match(v.url, /^https:\/\/raw\.githubusercontent\.com\//, `${k}: unexpected host`);
    assert.ok(v.label && v.portal, `${k}: missing label/portal`);
  }
});
