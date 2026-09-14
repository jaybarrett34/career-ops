import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROFILE_PATHS, INSTALL_LOCAL, PII_PATHS, DENY_DIRS, collect, safeRelative } from '../profile-bundle.mjs';
import { USER_PATHS } from '../update-system.mjs';

test('every user-layer path is classified as profile data or install-local', () => {
  // The line between "this belongs to a person" and "this belongs to this
  // install" has to be decided per file, and the decision is easy to forget when
  // a new user-layer file is added. This is the forcing function: adding to
  // USER_PATHS without choosing a side fails here.
  const profile = new Set(PROFILE_PATHS);
  const unclassified = USER_PATHS.filter((p) => !profile.has(p) && !(p in INSTALL_LOCAL));
  assert.deepEqual(unclassified, [],
    'add each to PROFILE_PATHS (a person owns it) or INSTALL_LOCAL with a reason (this machine owns it)');
});

test('the registry itself is never profile data', () => {
  // Jay's own root is ".", so an export that swept config/ would ship the file
  // mapping every person on the machine to their directory.
  assert.ok('config/roots.yml' in INSTALL_LOCAL);
  assert.ok(!PROFILE_PATHS.includes('config/roots.yml'));
});

test('safeRelative refuses escapes, absolutes and paths outside a profile', () => {
  assert.equal(safeRelative('cv.md'), true);
  assert.equal(safeRelative('data/applications.md'), true);
  assert.equal(safeRelative('reports/001-acme-2026-01-01.md'), true);
  assert.equal(safeRelative('../../etc/passwd'), false);
  assert.equal(safeRelative('data/../../etc/passwd'), false);
  assert.equal(safeRelative('/etc/passwd'), false);
  assert.equal(safeRelative('C:/windows/system32'), false);
  assert.equal(safeRelative('config/roots.yml'), false); // the registry never travels
  assert.equal(safeRelative('.venv/bin/pip'), false);
  assert.equal(safeRelative('a/node_modules/b'), false);
  assert.equal(safeRelative('data//x'), false);
  assert.equal(safeRelative(''), false);
  assert.equal(safeRelative(null), false);
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-bundle-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cv.md'), '# CV\n');
  fs.writeFileSync(path.join(dir, 'config', 'profile.yml'), 'name: Test\n');
  fs.writeFileSync(path.join(dir, 'config', 'roots.yml'), 'roots: []\n');
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), '# Tracker\n');
  fs.writeFileSync(path.join(dir, 'data', 'contacts.tsv'), 'name\temail\n');
  fs.writeFileSync(path.join(dir, 'data', 'applications.md.bak-2026'), 'old\n');
  fs.writeFileSync(path.join(dir, 'output', 'cv.pdf'), 'binary\n');
  return dir;
}

test('a root that is its own directory travels whole', () => {
  // The rule that matters in practice. A real profile keeps its own master doc,
  // its source documents and its trawl output under names career-ops never
  // defined; enumerating known files dropped all of it.
  const dir = fixture();
  try {
    fs.mkdirSync(path.join(dir, 'trawl'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'master-profile.md'), '# master\n');
    fs.writeFileSync(path.join(dir, 'trawl', 'boards.jsonl'), '{}\n');
    const { files, rule } = collect(dir);
    assert.equal(rule, 'whole-directory');
    assert.ok(files.includes('master-profile.md'));
    assert.ok(files.includes('trawl/boards.jsonl'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('caches, virtualenvs and build output never travel', () => {
  const dir = fixture();
  try {
    fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.venv', 'bin', 'pip'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(dir, '__pycache__', 'x.cpython-314.pyc'), 'x');
    const { files } = collect(dir);
    assert.ok(!files.some((f) => f.startsWith('.venv/')), '39MB of virtualenv must not travel');
    assert.ok(!files.some((f) => f.includes('__pycache__')));
    assert.ok(!files.includes('output/cv.pdf'));
    assert.ok(!files.includes('config/roots.yml'), 'the registry must not travel');
    assert.ok(!files.some((f) => f.includes('.bak-')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlink is not followed out of the profile', () => {
  const dir = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'co-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'not mine\n');
    fs.symlinkSync(outside, path.join(dir, 'linked'));
    const { files } = collect(dir);
    assert.ok(!files.some((f) => f.startsWith('linked')),
      'a link in a data root can point anywhere; following it would bundle a file from outside under an inside name');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a checkout-rooted profile takes only the listed files', () => {
  const dir = fixture();
  try {
    const { files, skippedPii, rule } = collect(dir, { scoped: true });
    assert.equal(rule, 'listed');
    assert.ok(files.includes('cv.md'));
    assert.ok(files.includes('config/profile.yml'));
    assert.ok(files.includes('data/applications.md'));

    assert.ok(!files.includes('config/roots.yml'), 'the registry must not travel');
    assert.ok(!files.includes('output/cv.pdf'), 'output is rebuildable');

    // Third-party PII stays put by default, and the caller is told.
    assert.ok(!files.includes('data/contacts.tsv'));
    assert.deepEqual(skippedPii, ['data/contacts.tsv']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--include-pii carries the contact files', () => {
  const dir = fixture();
  try {
    const { files, skippedPii } = collect(dir, { includePii: true, scoped: true });
    assert.ok(files.includes('data/contacts.tsv'));
    assert.deepEqual(skippedPii, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every PII path is inside a directory the profile actually exports', () => {
  // A PII exclusion for a file that would never be collected anyway is a
  // comment, not a guard — it would silently stop protecting anything if the
  // file moved.
  for (const p of PII_PATHS) assert.equal(safeRelative(p), true, `${p} is not under any PROFILE_PATHS entry`);
});
