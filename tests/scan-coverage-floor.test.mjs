import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVERAGE_FLOOR } from '../scan.mjs';

test('the coverage floor is declared, not inferred', () => {
  // A scan covering a sliver of its declared surface is indistinguishable from
  // a scan that found nothing, so the threshold has to be an explicit constant
  // someone chose rather than a heuristic that drifts.
  assert.equal(typeof COVERAGE_FLOOR, 'number');
  assert.ok(COVERAGE_FLOOR > 0 && COVERAGE_FLOOR <= 1);
});

test('the real failure this guards against is representable', () => {
  // Jay's portals.yml: 1 of 80 entries resolved to a provider, and every run
  // reported a confident summary about the one while 79 were skipped in a line
  // that scrolled past. 1/80 must be below the floor; a healthy root must not be.
  const jay = 1 / 80;
  const marilyn = 14 / 16;
  assert.ok(jay < COVERAGE_FLOOR, 'the broken config must halt');
  assert.ok(marilyn >= COVERAGE_FLOOR, 'a working config must not');
});
