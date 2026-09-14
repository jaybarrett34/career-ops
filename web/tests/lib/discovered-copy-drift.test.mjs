import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("web/src/lib/core/discovered.mjs is identical to the core's lib/discovered.mjs", () => {
  // Next cannot import across the web/ boundary cleanly, so this module exists
  // twice. A silent divergence would mean a lock set in the UI is keyed or
  // serialized differently from what the scanner reads back, which nothing else
  // would catch.
  const here = path.resolve(import.meta.dirname, "../../src/lib/core/discovered.mjs");
  const core = path.resolve(import.meta.dirname, "../../../lib/discovered.mjs");
  if (!fs.existsSync(core)) return; // data-only checkout
  assert.equal(fs.readFileSync(here, "utf8"), fs.readFileSync(core, "utf8"),
    "copies have diverged — re-copy lib/discovered.mjs into web/src/lib/core/");
});
