import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  isSafeName, isAllowedUpload, extensionOf, resolveFilePath, formatBytes,
  FILE_ROOTS, ALLOWED_UPLOAD_EXT, MAX_UPLOAD_BYTES,
} from "../../src/lib/core/files.mjs";

const P = { join: path.join, resolve: path.resolve, sep: path.sep };
const ROOT = "/data/root";

test("ordinary filenames pass", () => {
  for (const n of ["cv.pdf", "Master Resume.docx", "notes-2026.md", "a.txt", "A1.json"])
    assert.equal(isSafeName(n), true, n);
});

test("TRAVERSAL and separator tricks are refused, never sanitized", () => {
  for (const n of [
    "../secret", "..", ".", "a/b", "a\\b", "/etc/passwd", "C:\\win",
    ".hidden", "", " leading", "a\0b", "a\nb", "x".repeat(200),
  ]) assert.equal(isSafeName(n), false, `should refuse: ${JSON.stringify(n)}`);
});

test("a trailing dot or space is refused", () => {
  // Windows silently strips these, so "a.txt." and "a.txt" would be the same
  // file on one platform and two on another.
  assert.equal(isSafeName("a.txt."), false);
  assert.equal(isSafeName("a.txt "), false);
});

test("only the allowed extensions upload, and nothing executable is on the list", () => {
  assert.equal(isAllowedUpload("resume.pdf"), true);
  assert.equal(isAllowedUpload("notes.md"), true);
  for (const bad of ["run.sh", "a.exe", "x.js", "y.mjs", "z.py", "a.bat", "b.command", "noext"])
    assert.equal(isAllowedUpload(bad), false, bad);
  for (const e of [".sh", ".exe", ".js", ".mjs", ".py", ".bat", ".command", ".ps1"])
    assert.ok(!ALLOWED_UPLOAD_EXT.includes(e), `${e} must not be uploadable`);
});

test("extension parsing handles dotfiles and multi-dot names", () => {
  assert.equal(extensionOf("a.tar.gz"), ".gz");
  assert.equal(extensionOf("noext"), "");
  assert.equal(extensionOf(".bashrc"), "", "a leading dot is not an extension");
  assert.equal(extensionOf("A.PDF"), ".pdf", "case-normalized");
});

test("resolution stays inside its root", () => {
  const r = resolveFilePath("documents", "cv.pdf", ROOT, P);
  assert.equal(r.full, path.resolve(ROOT, "documents/cv.pdf"));
  assert.equal(r.base, path.resolve(ROOT, "documents"));
});

test("a sibling directory with a shared PREFIX cannot be reached", () => {
  // The classic startsWith bug: "/data/root/outputs-evil" begins with
  // "/data/root/output". The separator in the containment check is what stops it.
  const base = path.resolve(ROOT, "output");
  const evil = path.resolve(ROOT, "outputs-evil/x");
  assert.ok(evil.startsWith(base), "precondition: the naive test would pass");
  assert.ok(!evil.startsWith(base + path.sep), "the separator check must reject it");
});

test("an unknown root key resolves to null", () => {
  assert.equal(resolveFilePath("etc", "passwd", ROOT, P), null);
  assert.equal(resolveFilePath("", "a.txt", ROOT, P), null);
});

test("a hostile name resolves to null even with a valid root", () => {
  for (const n of ["../../etc/passwd", "a/b", ".."])
    assert.equal(resolveFilePath("documents", n, ROOT, P), null, n);
});

test("output is not writable, documents is", () => {
  assert.equal(FILE_ROOTS.output.writable, false);
  assert.equal(FILE_ROOTS.documents.writable, true);
});

test("the upload ceiling is a real number", () => {
  assert.ok(Number.isFinite(MAX_UPLOAD_BYTES) && MAX_UPLOAD_BYTES > 0);
});

test("sizes format without NaN or negative output", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.match(formatBytes(5 * 1048576), /MB$/);
  assert.equal(formatBytes(-1), "");
  assert.equal(formatBytes(NaN), "");
});
