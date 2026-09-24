import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationPasses } from '../target-list.mjs';

const DEFAULT_NEAR = ['chicago', 'illinois', 'denver', 'colorado', 'remote'];

test('word boundaries, not substrings', () => {
  // `--near ", IL "` trims to "il"; as a substring that matches Philadelphia,
  // Wilmington and Huntsville, and a Chicago-only list came back with three
  // states in it.
  const near = ['il'];
  assert.ok(locationPasses('Chicago, IL', near));
  for (const loc of ['Philadelphia, PA', 'Wilmington, DE', 'Huntsville, AL']) {
    assert.ok(!locationPasses(loc, near), loc);
  }
});

test('a foreign-only remote row is dropped, a US one is kept', () => {
  // "remote" matches anywhere on earth, so it cannot vouch for a location the
  // way a place name does -- and it is in the default --near.
  assert.ok(!locationPasses('Remote - Canada', DEFAULT_NEAR));
  assert.ok(!locationPasses('Remote, India', DEFAULT_NEAR));
  assert.ok(locationPasses('Remote - US', DEFAULT_NEAR));
  assert.ok(locationPasses('Remote (United States)', DEFAULT_NEAR));
});

test('a multi-location posting survives on its domestic office', () => {
  assert.ok(locationPasses('London, UK · Chicago, IL', DEFAULT_NEAR));
  assert.ok(locationPasses('Toronto, ON · Denver, CO', DEFAULT_NEAR));
});

test('--near on a foreign metro is not defeated by the foreign filter', () => {
  // The rescue used to be a hardcoded copy of the DEFAULT --near, so asking for
  // anywhere outside it dropped every row and printed an empty list.
  assert.ok(locationPasses('Toronto, ON, Canada', ['toronto']));
  assert.ok(locationPasses('London, UK', ['london']));
  assert.ok(locationPasses('New York, NY · Toronto, ON · Canada', ['new york']));
});

test('a row naming nowhere you asked for is dropped whatever else it says', () => {
  assert.ok(!locationPasses('Austin, TX', DEFAULT_NEAR));
  assert.ok(!locationPasses('', DEFAULT_NEAR));
});
