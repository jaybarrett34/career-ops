import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildFingerprint } from "../../src/lib/core/build-fingerprint.mjs";

test("the web copy and compose-resume.mjs hash identically", async () => {
  // If these drift, EVERY resume reads as stale and the badge stops meaning
  // anything — which is precisely the failure the fingerprint was added to fix.
  const core = path.resolve(import.meta.dirname, "../../../compose-resume.mjs");
  if (!fs.existsSync(core)) return; // data-only checkout
  const { buildFingerprint: theirs } = await import(core);

  const picked = [
    { id: "a", text: "Built a thing", rendered: "Built a thing" },
    { id: "b", text: "Shipped another", rendered: "Shipped another, briefly" },
  ];
  const template = "\\documentclass{article}\\begin{document}X\\end{document}";
  assert.equal(buildFingerprint(picked, template), theirs(picked, template));
});

test("the hash moves when anything on the page moves, and only then", () => {
  const tpl = "T";
  const base = [{ id: "a", text: "one" }, { id: "b", text: "two" }];
  const same = [{ id: "a", text: "one" }, { id: "b", text: "two" }];
  assert.equal(buildFingerprint(base, tpl), buildFingerprint(same, tpl));

  // Order is part of the page.
  assert.notEqual(buildFingerprint(base, tpl), buildFingerprint([base[1], base[0]], tpl));
  // Text is.
  assert.notEqual(buildFingerprint(base, tpl), buildFingerprint([{ id: "a", text: "ONE" }, base[1]], tpl));
  // The template is.
  assert.notEqual(buildFingerprint(base, tpl), buildFingerprint(base, "T2"));
  // The short variant actually rendered is what counts, not the full text.
  assert.notEqual(
    buildFingerprint([{ id: "a", text: "one", rendered: "1" }], tpl),
    buildFingerprint([{ id: "a", text: "one" }], tpl),
  );
});

test("two bullets cannot be confused by concatenation", () => {
  // Without a separator, {id:"ab",text:"c"} and {id:"a",text:"bc"} would collide.
  assert.notEqual(
    buildFingerprint([{ id: "ab", text: "c" }], "T"),
    buildFingerprint([{ id: "a", text: "bc" }], "T"),
  );
});
