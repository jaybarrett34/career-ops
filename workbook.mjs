#!/usr/bin/env node
/**
 * workbook.mjs — the tracker as a spreadsheet, and back again.
 *
 * Export alone is a dead end: a file you look at once. The loop that is actually
 * useful is export → work it in Excel, Numbers or Sheets → import the changes
 * back, which is why this has an `import` half at all.
 *
 * IMPORT IS MERGE, NEVER REPLACE
 *
 * A spreadsheet round-trip is a lossy channel: a column can be deleted, a row
 * filtered out and saved, an editor can reformat a date. So import updates
 * fields on rows it can MATCH and never deletes a tracker row that is missing
 * from the sheet — an absent row means "not in this view", not "delete this".
 * Every write goes through set-status.mjs, the canonical locked writer, rather
 * than rewriting the table directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { buildXlsx } from './lib/xlsx.mjs';
import { readXlsx, rowsToObjects } from './lib/xlsx-read.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';

const ROOT = getCareerOpsRoot();
const CODE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(n);

function usage() {
  console.log(`The tracker as a spreadsheet, and back.

  node workbook.mjs export                      # writes career-ops-<date>.xlsx
  node workbook.mjs export --out ~/Desktop
  node workbook.mjs import <file.xlsx>          # preview the changes
  node workbook.mjs import <file.xlsx> --apply  # write them

Import MERGES: it updates rows it can match by number or by company+role, and
never deletes a tracker row missing from the sheet. Status changes go through
set-status.mjs so validation and locking are the same as everywhere else.`);
}

const TRACKER_COLS = ['#', 'Date', 'Company', 'Role', 'Score', 'Status', 'PDF', 'Report', 'Notes', 'URL'];
// Sheet header → the key parseTrackerRow produces.
const COL_KEY = {
  '#': 'num', Date: 'date', Company: 'company', Role: 'role', Score: 'score',
  Status: 'status', PDF: 'pdf', Report: 'report', Notes: 'notes', URL: 'url',
};

function readTracker() {
  const file = resolveTrackerPath(ROOT);
  if (!fs.existsSync(file)) {
    console.error(`No tracker at ${file}.`);
    process.exit(1);
  }
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  // The column map is DETECTED, not assumed: a tracker may carry a Via or URL
  // column or not, and a fixed map would read the wrong cell on half of them.
  const colmap = resolveColumns(lines);
  return { file, rows: lines.map((l) => parseTrackerRow(l, colmap)).filter(Boolean) };
}

function doExport() {
  const { rows } = readTracker();
  const date = new Date().toISOString().slice(0, 10);

  const pipelineFile = path.join(ROOT, 'data/pipeline.md');
  const pipeline = fs.existsSync(pipelineFile)
    ? fs.readFileSync(pipelineFile, 'utf-8').split('\n')
      .filter((l) => l.startsWith('- [ ]'))
      .map((l) => l.slice(6).split(' | ').map((s) => s.trim()))
      .map((s) => [s[1] ?? '', s[2] ?? '', s[3] ?? '', s[0] ?? ''])
    : [];

  const sheets = [
    {
      name: 'Tracker',
      rows: [TRACKER_COLS, ...rows.map((r) => TRACKER_COLS.map((c) => String(r[COL_KEY[c]] ?? '')))],
    },
  ];
  if (pipeline.length) {
    sheets.push({ name: 'Pipeline', rows: [['Company', 'Role', 'Location', 'URL'], ...pipeline] });
  }

  const outDir = path.resolve(process.cwd(), arg('--out', '.'));
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `career-ops-${date}.xlsx`);
  fs.writeFileSync(outFile, buildXlsx(sheets));
  console.log(`${outFile}`);
  console.log(`  Tracker: ${rows.length} rows${pipeline.length ? ` · Pipeline: ${pipeline.length} rows` : ''}`);
  console.log('\nEdit the Status column, then: node workbook.mjs import <file> --apply');
}

/** Match a sheet row to a tracker row: by number first, then company+role. */
export function matchRow(sheetRow, trackerRows) {
  const num = String(sheetRow['#'] ?? '').trim();
  if (num && /^\d+$/.test(num)) {
    const byNum = trackerRows.find((t) => String(t.num ?? '').trim() === num);
    if (byNum) return { row: byNum, how: 'number' };
  }
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const co = norm(sheetRow.Company), ro = norm(sheetRow.Role);
  if (!co) return null;
  const hits = trackerRows.filter((t) => norm(t.company) === co && (!ro || norm(t.role) === ro));
  // Two rows matching one sheet row is ambiguous; refuse rather than guess which
  // application the edit was meant for.
  return hits.length === 1 ? { row: hits[0], how: 'company+role' } : null;
}

function doImport() {
  const src = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : arg('--file');
  if (!src) { usage(); process.exit(1); }
  const file = path.resolve(process.cwd(), src);
  if (!fs.existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }

  let sheets;
  try {
    sheets = readXlsx(fs.readFileSync(file));
  } catch (e) {
    console.error(`Could not read ${path.basename(file)}: ${e.message}`);
    process.exit(1);
  }
  const tracker = sheets.find((s) => /tracker/i.test(s.name)) ?? sheets[0];
  if (!tracker) { console.error('No sheets in that workbook.'); process.exit(1); }

  const sheetRows = rowsToObjects(tracker.rows);
  const { rows: trackerRows } = readTracker();
  const apply = flag('--apply');

  const changes = [], unmatched = [];
  for (const s of sheetRows) {
    const m = matchRow(s, trackerRows);
    if (!m) { unmatched.push(s); continue; }
    const from = String(m.row.status ?? '').trim();
    const to = String(s.Status ?? '').trim();
    if (to && to !== from) changes.push({ num: m.row.num, company: m.row.company, from, to, how: m.how });
  }

  console.log(`${path.basename(file)} — sheet "${tracker.name}", ${sheetRows.length} rows`);
  if (!changes.length) console.log('No status changes.');
  for (const c of changes) console.log(`  #${c.num} ${c.company}: ${c.from || '—'} → ${c.to}   (matched by ${c.how})`);
  if (unmatched.length) {
    console.log(`\n  ${unmatched.length} sheet row(s) matched no tracker row and were ignored:`);
    for (const u of unmatched.slice(0, 5)) console.log(`    ${u.Company ?? '?'} — ${u.Role ?? '?'}`);
    console.log('  (a new row here is not added: use the TSV path so evaluation stays the source of truth)');
  }
  // A tracker row absent from the sheet is NOT a deletion. Say so, because a
  // filtered export is the normal way to get one.
  const inSheet = new Set(sheetRows.map((s) => String(s['#'] ?? '')));
  const missing = trackerRows.filter((t) => !inSheet.has(String(t.num ?? ''))).length;
  if (missing) console.log(`\n  ${missing} tracker row(s) are not in this sheet. Left untouched.`);

  if (!apply) { console.log('\n(preview: --apply to write these)'); return; }
  if (!changes.length) return;

  let ok = 0;
  for (const c of changes) {
    let out = '';
    try {
      // --row, not a bare number: a bare selector is ambiguous between a tracker
      // row and a report ID, and set-status refuses rather than guessing. We are
      // always addressing tracker rows here.
      out = execFileSync(process.execPath, [path.join(CODE, 'set-status.mjs'),
        '--row', String(c.num), c.to, '--note', `imported from ${path.basename(file)}`],
      { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      out = String(e.stdout || e.stderr || e.message);
    }
    // set-status EXITS 0 when it refuses -- a guard answered is not a crash --
    // so the exit code alone reported failures as successes. The output is what
    // says whether anything was written.
    if (/^\s*❌/m.test(out) || /\bRefus/i.test(out)) {
      console.error(`  #${c.num}: ${out.trim().split('\n')[0]}`);
    } else {
      ok++;
    }
  }
  console.log(`\n${ok} of ${changes.length} written via set-status.mjs.`);
  if (ok < changes.length) console.log('The rest were refused above and the tracker is unchanged for them.');
}

function main() {
  const cmd = process.argv[2];
  if (!cmd || flag('--help') || flag('-h')) return usage();
  if (cmd === 'export') return doExport();
  if (cmd === 'import') return doImport();
  console.error(`Unknown command "${cmd}".`);
  process.exit(1);
}

if (isMainModule(import.meta.url)) main();
