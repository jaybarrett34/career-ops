import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("web/src/lib/core/xlsx.mjs is identical to the core's lib/xlsx.mjs", () => {
  // Next cannot import across the web/ boundary cleanly, so this module exists
  // twice. A silent divergence would mean the CLI and the web app emit
  // different workbooks from the same data, which nothing else would catch.
  const here = path.resolve(import.meta.dirname, "../../src/lib/core/xlsx.mjs");
  const core = path.resolve(import.meta.dirname, "../../../lib/xlsx.mjs");
  if (!fs.existsSync(core)) return; // data-only checkout
  assert.equal(fs.readFileSync(here, "utf8"), fs.readFileSync(core, "utf8"),
    "copies have diverged — re-copy lib/xlsx.mjs into web/src/lib/core/");
});
