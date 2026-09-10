import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { normalizeRoots, checkRoot, resolveActiveRoot } from "../../src/lib/core/roots.mjs";

// ── normalizeRoots ───────────────────────────────────────────────────────────

test("absent registry yields no roots and no complaint", () => {
  assert.deepEqual(normalizeRoots(undefined), { roots: [], errors: [] });
  assert.deepEqual(normalizeRoots(null), { roots: [], errors: [] });
});

test("accepts a bare list and a mapping with roots:", () => {
  const entry = [{ id: "jay", path: "/a" }];
  assert.equal(normalizeRoots(entry).roots.length, 1);
  assert.equal(normalizeRoots({ roots: entry }).roots.length, 1);
});

test("label defaults to id; enabled defaults to true (opt-out)", () => {
  const { roots } = normalizeRoots([{ id: "jay", path: "/a" }]);
  assert.equal(roots[0].label, "jay");
  assert.equal(roots[0].enabled, true);
});

test("enabled: false is respected; other falsey values are not", () => {
  assert.equal(normalizeRoots([{ id: "a", path: "/a", enabled: false }]).roots[0].enabled, false);
  assert.equal(normalizeRoots([{ id: "b", path: "/b", enabled: 0 }]).roots[0].enabled, true);
});

test("one malformed entry is dropped, the rest still load", () => {
  const { roots, errors } = normalizeRoots([
    { id: "good", path: "/a" },
    { id: "", path: "/b" },
    { id: "also-good", path: "/c" },
  ]);
  assert.deepEqual(roots.map((r) => r.id), ["good", "also-good"]);
  assert.equal(errors.length, 1);
});

test("duplicate ids: first wins, duplicate reported", () => {
  const { roots, errors } = normalizeRoots([
    { id: "jay", path: "/first" },
    { id: "JAY", path: "/second" },
  ]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].path, "/first");
  assert.match(errors[0], /duplicate/i);
});

test("entries without a path are rejected", () => {
  const { roots, errors } = normalizeRoots([{ id: "jay" }]);
  assert.equal(roots.length, 0);
  assert.match(errors[0], /missing path/i);
});

test("ids with path separators are rejected outright", () => {
  for (const id of ["../etc", "a/b", "a\\b", ".", ".."]) {
    const { roots } = normalizeRoots([{ id, path: "/a" }]);
    assert.equal(roots.length, 0, `id should be rejected: ${id}`);
  }
});

// ── checkRoot ────────────────────────────────────────────────────────────────

function fsq(present, dirs = present) {
  const set = new Set(present);
  const dirSet = new Set(dirs);
  return {
    exists: (p) => set.has(p),
    isDir: (p) => dirSet.has(p),
    resolve: (...a) => path.resolve(...a),
  };
}

test("a root with cv.md passes", () => {
  const root = "/data/jay";
  const q = fsq([root, path.resolve(root, "cv.md")], [root]);
  assert.deepEqual(checkRoot({ id: "jay", label: "Jay", path: root, enabled: true }, q), { ok: true });
});

test("config/profile.yml alone is enough", () => {
  const root = "/data/jay";
  const q = fsq([root, path.resolve(root, "config/profile.yml")], [root]);
  assert.equal(checkRoot({ id: "jay", label: "Jay", path: root, enabled: true }, q).ok, true);
});

test("an EMPTY directory is refused — it would look like data loss", () => {
  const root = "/data/empty";
  const q = fsq([root], [root]);
  const v = checkRoot({ id: "e", label: "e", path: root, enabled: true }, q);
  assert.equal(v.ok, false);
  assert.match(v.reason, /not a career-ops data root/i);
});

test("a missing path is refused", () => {
  const v = checkRoot({ id: "x", label: "x", path: "/nope", enabled: true }, fsq([]));
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not exist/);
});

test("a file (not a directory) is refused", () => {
  const p = "/data/file.txt";
  const v = checkRoot({ id: "f", label: "f", path: p, enabled: true }, fsq([p], []));
  assert.equal(v.ok, false);
  assert.match(v.reason, /not a directory/);
});

test("a disabled root is refused even when otherwise valid", () => {
  const root = "/data/jay";
  const q = fsq([root, path.resolve(root, "cv.md")], [root]);
  assert.equal(checkRoot({ id: "jay", label: "Jay", path: root, enabled: false }, q).ok, false);
});

// ── resolveActiveRoot — the traversal gate ───────────────────────────────────

const OK = () => ({ ok: true });
const REGISTRY = [
  { id: "jay", label: "Jay", path: "/data/jay", enabled: true },
  { id: "mom", label: "Mom", path: "/data/mom", enabled: true },
];
const DEFAULT = "/repo";
const res = (id, check = OK, roots = REGISTRY) =>
  resolveActiveRoot(roots, id, DEFAULT, check, (...a) => path.resolve(...a));

test("no selection → the default root", () => {
  assert.deepEqual(res(null), { path: DEFAULT, id: null, fellBack: false });
});

test("a known id resolves to its registered path", () => {
  assert.equal(res("mom").path, "/data/mom");
  assert.equal(res("mom").id, "mom");
});

test("id matching is case-insensitive", () => {
  assert.equal(res("MOM").path, "/data/mom");
});

test("TRAVERSAL: a path in place of an id never escapes the registry", () => {
  for (const evil of [
    "../../../../etc",
    "/etc/passwd",
    "..%2F..%2Fetc",
    "jay/../../../etc",
    "....//....//etc",
    "\\\\server\\share",
  ]) {
    const out = res(evil);
    assert.equal(out.path, DEFAULT, `must not resolve: ${evil}`);
    assert.equal(out.id, null);
    assert.equal(out.fellBack, true);
  }
});

test("an unknown id falls back instead of erroring — a stale cookie must not brick the app", () => {
  const out = res("deleted-root");
  assert.equal(out.path, DEFAULT);
  assert.equal(out.fellBack, true);
  assert.match(out.reason, /unknown root/);
});

test("a known but now-unusable root falls back, and says why", () => {
  const out = res("mom", () => ({ ok: false, reason: "path does not exist: /data/mom" }));
  assert.equal(out.path, DEFAULT);
  assert.equal(out.fellBack, true);
  assert.match(out.reason, /unusable/);
  assert.match(out.reason, /does not exist/);
});

test("the requested id is never used to build a path", () => {
  // If the id were concatenated anywhere, this registry (whose only entry has a
  // path unrelated to its id) would leak the id into the result.
  const roots = [{ id: "alpha", label: "Alpha", path: "/somewhere/else", enabled: true }];
  assert.equal(res("alpha", OK, roots).path, "/somewhere/else");
});
