import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isNestedCheckout } from "../../../lib/mjs-files.mjs";

/**
 * Every entry point that can reach careerOpsRoot() must establish a profile
 * scope.
 *
 * WHY THIS TEST EXISTS
 *
 * withProfile() is AsyncLocalStorage, and activeRoot() returns null outside any
 * scope, so careerOpsRoot() falls back to the DEFAULT root. An unwrapped entry
 * point therefore keeps working — it just silently reads the default person's
 * data while the switcher claims another is active.
 *
 * That is the worst possible failure mode for this feature: no crash, no error,
 * no visible symptom, and the wrong person's tracker on screen. Code review does
 * not catch it, because the missing thing is an absence.
 *
 * So completeness is enforced mechanically. Reachability is COMPUTED from the
 * import graph rather than hand-listed: a hand-written list silently stops
 * covering whatever is added next, which is the same class of bug.
 */

const SRC = path.resolve(import.meta.dirname, "../../src");
const EXT = [".ts", ".tsx", ".mjs"];

/**
 * Entry points that reach careerOpsRoot() but are deliberately NOT scoped.
 * Each needs a reason. Empty by design — add only with a real justification.
 * @type {Record<string, string>}
 */
const EXEMPT = {};

function resolveSpec(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // bare package specifier
  const cands = [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, "index" + e))];
  return cands.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) ?? null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!isNestedCheckout(p)) walk(p, out); }
    else if (EXT.includes(path.extname(p))) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const graph = new Map();
const usesRoot = new Set();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  if (/\bcareerOpsRoot\s*\(/.test(text)) usesRoot.add(f);
  const deps = new Set();
  for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const r = resolveSpec(m[1], f);
    if (r) deps.add(r);
  }
  graph.set(f, deps);
}

function reachesRoot(start, seen = new Set()) {
  if (seen.has(start)) return false;
  seen.add(start);
  if (usesRoot.has(start)) return true;
  for (const d of graph.get(start) ?? []) if (reachesRoot(d, seen)) return true;
  return false;
}

const entryPoints = files
  .filter((f) => /(^|[\\/])(page\.tsx|route\.ts)$/.test(f))
  .filter((f) => f.startsWith(path.join(SRC, "app")));

const rel = (f) => path.relative(path.join(SRC, "app"), f).split(path.sep).join("/");

test("the reachability analysis actually finds callers (guard against a silent no-op)", () => {
  // If resolveSpec ever breaks, every entry point resolves to "no user data" and
  // this suite passes while checking nothing. Pin the preconditions.
  assert.ok(usesRoot.size > 0, "no file appears to call careerOpsRoot() — the scan is broken");
  assert.ok(entryPoints.length > 20, `only ${entryPoints.length} entry points found — the walk is broken`);
  const needing = entryPoints.filter((f) => reachesRoot(f));
  assert.ok(needing.length > 0, "no entry point reaches careerOpsRoot() — the graph is broken");
});

test("every entry point that reaches careerOpsRoot() establishes a profile scope", () => {
  const missing = [];
  for (const f of entryPoints) {
    if (!reachesRoot(f)) continue;
    const name = rel(f);
    if (name in EXEMPT) continue;
    const text = fs.readFileSync(f, "utf8");
    // The scope is established by importing one of the entry-point helpers.
    const scoped = /\bwith(Profile|ActiveProfile|ActiveProfilePage)\b/.test(text);
    if (!scoped) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `these entry points read user data without a profile scope, so they would ` +
      `silently serve the DEFAULT root while the switcher claims another:\n  ` +
      missing.join("\n  "),
  );
});

test("no stale exemptions", () => {
  const names = new Set(entryPoints.map(rel));
  const stale = Object.keys(EXEMPT).filter((k) => !names.has(k));
  assert.deepEqual(stale, [], `EXEMPT lists entry points that no longer exist: ${stale.join(", ")}`);
});
