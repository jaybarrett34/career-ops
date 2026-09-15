import { test } from "node:test";
import assert from "node:assert/strict";
import { inventory, staleness, fileForId, PDF_CANDIDATES } from "../../src/lib/core/resume-inventory.mjs";

const T = { tex: 1000, bullets: 2000, resumes: 1500, pdfOld: 900, pdfNew: 3000 };

function fakeFs(files) {
  return {
    exists: (p) => p in files,
    stat: (p) => (p in files ? { mtimeMs: files[p], size: 100 } : null),
    resolve: (...a) => a.join("/").replace(/\/+/g, "/"),
    readJson: () => null,
  };
}

test("a fingerprint match beats every mtime, and a mismatch beats them too", () => {
  // The exact answer wins when it is available: an unrelated edit that bumps a
  // config file's mtime must not mark a PDF stale, and a real content change
  // must mark it stale even if every mtime looks fine.
  assert.equal(staleness(1, { "the template": 9999 }, { recorded: "abc", current: "abc" }).stale, false);
  const s = staleness(9999, { "the template": 1 }, { recorded: "abc", current: "xyz" });
  assert.equal(s.stale, true);
  assert.match(s.reason, /bullets or template changed/);
});

test("a PDF older than any of its inputs is stale when no fingerprint exists", () => {
  // Checking only the template would call a PDF current after the bullet it
  // renders was rewritten, which is the case that actually bites: bullets change
  // far more often than templates do.
  assert.equal(staleness(500, { "the template": 1000 }).stale, true);
  assert.equal(staleness(500, { "the bullet library": 1000 }).stale, true);
  assert.equal(staleness(5000, { "the template": 1000, "the bullet library": 2000 }).stale, false);
});

test("staleness names every input that moved, not just the first", () => {
  const s = staleness(500, { "the template": 1000, "the bullet library": 2000 });
  assert.match(s.reason, /the template and the bullet library/);
});

test("a resume that was never built is stale, and says so plainly", () => {
  const s = staleness(null, { "the template": 1000 });
  assert.equal(s.stale, true);
  assert.equal(s.reason, "never built");
});

test("the newest candidate PDF location wins", () => {
  // compose writes to output/<id>/<id>.pdf but older runs left copies elsewhere;
  // showing the stale one would misreport what is on disk.
  const files = {
    "/root/output/swe/swe.pdf": T.pdfOld,
    "/root/output/rebuild/swe.pdf": T.pdfNew,
    "/root/tpl/swe.tex": T.tex,
    "/root/config/bullets.yml": T.bullets,
    "/root/config/resumes.yml": T.resumes,
  };
  const inv = inventory([{ id: "swe", template: "tpl/swe.tex", bullets: ["a"] }], "/root", fakeFs(files));
  assert.equal(inv[0].pdfPath, "/root/output/rebuild/swe.pdf");
  assert.equal(inv[0].stale, false, "the newest PDF postdates every input");
});

test("PDF_CANDIDATES covers the locations compose actually writes", () => {
  const c = PDF_CANDIDATES("swe");
  assert.ok(c.includes("output/swe/swe.pdf"));
  assert.ok(c.includes("output/rebuild/swe.pdf"));
});

test("a tailored resume is distinguished from a foundational one", () => {
  const files = { "/root/tpl/swe.tex": T.tex };
  const inv = inventory([
    { id: "swe", template: "tpl/swe.tex", bullets: [] },
    { id: "swe-nt", template: "tpl/swe.tex", tailored_from: "swe", bullets: [] },
  ], "/root", fakeFs(files));
  assert.equal(inv[0].foundational, true);
  assert.equal(inv[1].foundational, false);
  assert.equal(inv[1].tailoredFrom, "swe");
});

test("a missing template is reported, not hidden", () => {
  const inv = inventory([{ id: "swe", template: "tpl/gone.tex", bullets: [] }], "/root", fakeFs({}));
  assert.equal(inv[0].templateExists, false);
  assert.equal(inv[0].stale, true);
});

test("fileForId resolves only ids the config already declares", () => {
  // The guard that replaces the Files route's containment check: templates live
  // outside the data root on purpose, so nothing may arrive as a path.
  const files = { "/root/tpl/swe.tex": T.tex, "/root/output/swe/swe.pdf": T.pdfNew };
  const inv = inventory([{ id: "swe", template: "tpl/swe.tex", bullets: [] }], "/root", fakeFs(files));
  assert.equal(fileForId(inv, "swe", "tex"), "/root/tpl/swe.tex");
  assert.equal(fileForId(inv, "swe", "pdf"), "/root/output/swe/swe.pdf");
  assert.equal(fileForId(inv, "../../etc/passwd", "tex"), null);
  assert.equal(fileForId(inv, "swe", "exe"), null);
  assert.equal(fileForId(inv, "nope", "pdf"), null);
});

test("an unbuilt resume serves no PDF", () => {
  const inv = inventory([{ id: "swe", template: "tpl/swe.tex", bullets: [] }], "/root", fakeFs({ "/root/tpl/swe.tex": T.tex }));
  assert.equal(fileForId(inv, "swe", "pdf"), null);
});
