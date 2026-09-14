#!/usr/bin/env node
/**
 * profile-bundle.mjs — move one person's career-ops data root to another machine.
 *
 * WHY A CLI AND NOT A ROUTE
 *
 * Importing registers a path in config/roots.yml, and that file's whole security
 * property is that the app never writes a path into it: the registry is the only
 * source of selectable directories, so no request can name one outside it. A
 * shell invocation is the user acting directly, which is a different trust
 * position from a request the app received. Export alone would be safe over HTTP
 * (it only reads); import is not, so both live here and neither is a route.
 *
 * WHY A DIRECTORY AND NOT AN ARCHIVE
 *
 * The intended shape for a profile is already its own private git repository —
 * see FORK.md and config/roots.example.yml. Export therefore materializes a
 * standalone DIRECTORY the user can `git init` and push, rather than a tarball.
 * That also means there is no archive parser here and so no archive-traversal
 * surface to defend.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { isNestedCheckout } from './lib/mjs-files.mjs';

const CHECKOUT = getCareerOpsRoot();

/**
 * What belongs to a PERSON when the root IS the code checkout.
 *
 * Two different situations need two different rules, and the first version of
 * this script got it wrong by using one.
 *
 * When the data root is its OWN directory, everything in it is the person's data
 * by definition and the right rule is take-all-minus-DENY (see collect). The
 * enumerated list below silently dropped almost all of a real profile: run
 * against a root holding master-profile.md, source/, trawl/ and a folder of
 * finished resumes and cover letters, it exported 6 files out of ~90 and left
 * the entire search behind. A missing file is silent data loss on the far
 * machine; an extra file is a slightly larger repository.
 *
 * When the root IS the checkout — `path: "."`, which is the single-person
 * default — take-all would ship the source tree and, worse, config/roots.yml:
 * the registry mapping every person on the machine to their directory. So that
 * case, and only that case, uses this list.
 *
 * Note this is NOT derived from USER_PATHS. USER_PATHS answers "will an update
 * overwrite it", a different question: it also covers fork documentation
 * (FORK.md, NEXT.md) and per-install CLI config.
 */
export const PROFILE_PATHS = [
  'cv.md',
  'article-digest.md',
  'voice-dna.md',
  'portals.yml',
  'config/profile.yml',
  'config/archetypes.yml',
  'config/bullets.yml',
  'config/resumes.yml',
  'config/discovered.yml',
  'config/cv-facts.json',
  'modes/_profile.md',
  'modes/_custom.md',
  'modes/_brief.md',
  'data/',
  'reports/',
  'jds/',
  'documents/',
  'interview-prep/',
  'writing-samples/',
];

/**
 * User-layer paths that are NOT a person's data, with the reason.
 *
 * tests/profile-bundle.test.mjs asserts every USER_PATHS entry appears in one
 * list or the other, so a new user-layer file cannot be added without someone
 * deciding which side of the line it falls on.
 */
export const INSTALL_LOCAL = {
  'FORK.md': 'fork documentation, ships with the code',
  'NEXT.md': 'working notes on the code, not on a job search',
  'config/roots.yml': 'the registry itself — maps every person on this machine to a path',
  'config/plugins.yml': 'which integrations this install enables',
  'plugins.local/': 'installed plugin code',
  'plugins.lock': 'installed plugin versions',
  'opencode.json': 'per-install CLI config',
  '.claude/settings.json': 'per-install CLI config',
  '.claude/hooks/': 'per-install CLI hooks',
  'output/': 'generated PDFs, rebuildable from cv.md',
};

/**
 * Third-party personal data, excluded unless the user asks for it.
 *
 * These hold other people's names, emails and phone numbers rather than the
 * profile owner's. Copying a directory to another machine is exactly when that
 * distinction matters, so the default is to leave them behind and say so.
 */
export const PII_PATHS = new Set(['data/contacts.tsv', 'data/Connections.csv']);

/**
 * Never travels, whichever rule is in force.
 *
 * Directory names are matched at any depth; the rest are matched as a path
 * relative to the root. Everything here is either rebuildable (output/, caches),
 * belongs to the machine rather than the person (the registry, virtualenvs), or
 * is an artifact of an atomic write.
 */
export const DENY_DIRS = new Set(['.git', '.venv', 'venv', 'node_modules', '__pycache__', '.next', '.pytest_cache', '.mypy_cache', 'output']);
// The manifest describes the bundle; it is not part of the profile, so a
// re-export of an imported bundle does not accumulate copies of it.
export const MANIFEST = '.career-ops-profile.yml';
export const DENY_PATHS = new Set(['config/roots.yml', MANIFEST]);
const DENY_FILE_RE = /^\.DS_Store$|\.(bak-|tmp-)|\.pyc$/;

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(n);

/**
 * Every file that should travel, as paths relative to the root.
 *
 * `scoped` forces the enumerated rule; by default it is chosen automatically by
 * whether the root is the checkout. See PROFILE_PATHS for why there are two.
 */
export function collect(root, { includePii = false, scoped = null } = {}) {
  const useList = scoped ?? path.resolve(root) === path.resolve(CHECKOUT);
  const out = [], skippedPii = [];

  const walk = (abs, rel) => {
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    // Symlinks are not followed: a link in a data root can point anywhere, and
    // copying through one would place a file from outside the profile into the
    // bundle under a name that says it came from inside.
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(abs).sort()) {
        if (DENY_DIRS.has(e) || DENY_FILE_RE.test(e)) continue;
        const childAbs = path.join(abs, e);
        // A repository nested inside a data root is a separate project that
        // happens to live there -- a vendored dependency, a cloned tool. Its
        // working tree is not this person's job search, and sweeping it in would
        // put an entire other codebase in the bundle.
        if (isNestedCheckout(childAbs)) continue;
        walk(childAbs, rel ? path.join(rel, e) : e);
      }
      return;
    }
    if (!st.isFile()) return;
    const key = rel.split(path.sep).join('/');
    if (DENY_PATHS.has(key)) return;
    if (!includePii && PII_PATHS.has(key)) { skippedPii.push(key); return; }
    out.push(key);
  };

  if (useList) for (const p of PROFILE_PATHS) { const r = p.replace(/\/$/, ''); walk(path.join(root, r), r); }
  else walk(root, '');
  return { files: out, skippedPii, rule: useList ? 'listed' : 'whole-directory' };
}

/** A path is safe to write under a destination only if it stays under it. */
export function safeRelative(p) {
  if (typeof p !== 'string' || !p) return false;
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  const segs = p.split('/');
  if (segs.some((s) => s === '..' || s === '')) return false;
  if (DENY_PATHS.has(p)) return false;
  return !p.split('/').some((s) => DENY_DIRS.has(s));
}

function resolveRoot(id) {
  const file = path.join(CHECKOUT, 'config/roots.yml');
  let reg;
  try {
    reg = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch {
    return { root: CHECKOUT, label: 'this checkout', id: id || 'default' };
  }
  const roots = Array.isArray(reg?.roots) ? reg.roots : [];
  if (!id) {
    const names = roots.map((r) => r.id).join(', ');
    console.error(`--profile is required. Known: ${names || '(none registered)'}`);
    process.exit(1);
  }
  const hit = roots.find((r) => r.id === id);
  if (!hit) {
    console.error(`No profile "${id}" in config/roots.yml. Known: ${roots.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }
  return { root: path.resolve(CHECKOUT, String(hit.path).replace(/^~(?=\/)/, process.env.HOME ?? '~')), label: hit.label, id: hit.id };
}

function doExport() {
  const { root, label, id } = resolveRoot(arg('--profile'));
  const dest = arg('--out');
  if (!dest) { console.error('--out <directory> is required.'); process.exit(1); }
  const outDir = path.resolve(process.cwd(), dest);
  const includePii = flag('--include-pii');

  if (fs.existsSync(outDir) && fs.readdirSync(outDir).some((e) => e !== '.git')) {
    console.error(`${outDir} is not empty. Choose an empty directory (a .git/ already there is fine).`);
    process.exit(1);
  }

  const { files, skippedPii, rule } = collect(root, { includePii, scoped: flag('--scoped') ? true : null });
  if (!files.length) {
    console.error(`${root} has no profile data to export.`);
    process.exit(1);
  }

  for (const rel of files) {
    const to = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, rel), to);
  }

  const manifest = {
    career_ops_profile: 1,
    id,
    label,
    exported_from: root,
    exported_at: new Date().toISOString().slice(0, 10),
    rule,
    includes_third_party_pii: includePii && skippedPii.length > 0,
    files,
  };
  fs.writeFileSync(path.join(outDir, MANIFEST), yaml.dump(manifest, { lineWidth: 100, noRefs: true }));

  console.log(`Exported ${files.length} file${files.length === 1 ? '' : 's'} for "${label}" to ${outDir}`);
  console.log(rule === 'listed'
    ? '  (the root is this checkout, so only known profile files were taken -- not the code or the registry)'
    : '  (the root is its own directory, so everything in it travelled except caches, output and virtualenvs)');
  if (skippedPii.length) {
    console.log(`Left behind (other people's personal data; --include-pii to carry it): ${skippedPii.join(', ')}`);
  }
  console.log('\nTo move it:');
  console.log(`  cd ${outDir} && git init && git add -A && git commit -m "profile: ${label}"`);
  console.log('  git remote add origin <a PRIVATE repo> && git push -u origin main');
  console.log('\nOn the other machine:');
  console.log('  git clone <that repo> ~/career-data');
  console.log(`  node profile-bundle.mjs import ~/career-data --id ${id} --register`);
}

function doImport() {
  const src = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : arg('--from');
  if (!src) { console.error('Usage: node profile-bundle.mjs import <directory> [--id <id>] [--register]'); process.exit(1); }
  const dir = path.resolve(process.cwd(), src);

  let manifest = null;
  try {
    manifest = yaml.load(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch { /* a hand-made data root is still importable; see below */ }

  // The bundle's own manifest is untrusted input: it arrived over the network in
  // a repository. Nothing in it is used to build a write path here (import only
  // VALIDATES an existing directory), but a manifest naming files outside the
  // profile is a sign the bundle is not what it claims, so it is refused.
  if (manifest) {
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const bad = files.filter((f) => !safeRelative(f));
    if (bad.length) {
      console.error(`Refusing ${dir}: its manifest names ${bad.length} path(s) outside a profile, e.g. ${bad[0]}`);
      process.exit(1);
    }
    const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)));
    if (missing.length) console.log(`Note: ${missing.length} file(s) in the manifest are absent, e.g. ${missing[0]}`);
  }

  // Same rule config/roots.example.yml states, and the same one checkRoot
  // enforces: an empty directory presents as an install with no data, which is
  // indistinguishable from data loss.
  const hasData = fs.existsSync(path.join(dir, 'cv.md')) || fs.existsSync(path.join(dir, 'config/profile.yml'));
  if (!hasData) {
    console.error(`Refusing ${dir}: no cv.md and no config/profile.yml, so it is not a career-ops data root.`);
    process.exit(1);
  }

  const id = arg('--id') || (manifest && typeof manifest.id === 'string' ? manifest.id : null);
  const label = arg('--label') || (manifest && typeof manifest.label === 'string' ? manifest.label : id);
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    console.error('--id is required (letters, digits, - and _, max 64).');
    process.exit(1);
  }

  const { files } = collect(dir, { includePii: true });
  console.log(`${dir} holds ${files.length} profile file(s)${manifest ? ` for "${label}"` : ''}.`);

  const regFile = path.join(CHECKOUT, 'config/roots.yml');
  let reg = { roots: [] };
  try { reg = yaml.load(fs.readFileSync(regFile, 'utf8')) || { roots: [] }; } catch { /* first profile */ }
  const roots = Array.isArray(reg.roots) ? reg.roots : [];
  if (roots.some((r) => r.id === id)) {
    console.error(`config/roots.yml already has an id "${id}". Pick another with --id, or edit the file.`);
    process.exit(1);
  }

  const stanza = `  - id: ${id}\n    label: "${String(label).replace(/"/g, '\\"')}"\n    path: "${dir}"\n`;
  if (!flag('--register')) {
    console.log('\nAdd this to config/roots.yml under `roots:` (or re-run with --register):\n');
    console.log(stanza);
    return;
  }

  // Writing the registry from a SHELL invocation is the user acting directly.
  // The app still never does this; see the header.
  const prior = fs.existsSync(regFile) ? fs.readFileSync(regFile, 'utf8').replace(/\s*$/, '') : 'roots:';
  fs.writeFileSync(regFile, `${prior}\n\n${stanza}`);
  console.log(`\nRegistered "${label}" as ${id} in config/roots.yml.`);
  console.log('Switch to it in the web UI, or run with CAREER_OPS_ROOT set to that path.');
}

function usage() {
  console.log(`Move one person's career-ops data root between machines.

  node profile-bundle.mjs export --profile <id> --out <dir>   # materialize a standalone directory
  node profile-bundle.mjs export --profile <id> --out <dir> --include-pii
  node profile-bundle.mjs export --profile <id> --out <dir> --scoped   # only the known career-ops files
  node profile-bundle.mjs import <dir> [--id <id>] [--label "..."] [--register]

Export writes a directory you can git init and push to a PRIVATE repo. Import
validates a cloned directory and prints (or with --register, writes) its
config/roots.yml entry.`);
}

function main() {
  const cmd = process.argv[2];
  if (!cmd || flag('--help') || flag('-h')) return usage();
  if (cmd === 'export') return doExport();
  if (cmd === 'import') return doImport();
  console.error(`Unknown command "${cmd}". Try --help.`);
  process.exit(1);
}

if (isMainModule(import.meta.url)) main();
