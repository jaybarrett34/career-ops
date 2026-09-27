#!/usr/bin/env node
/**
 * Turn a target list into a run sheet grouped by ATS TENANT.
 *
 * Ranking order is the wrong order to APPLY in. A Workday or iCIMS account is
 * per tenant, so doing one employer's roles back to back pays the signup once
 * instead of once per posting — six Shure roles on one iCIMS account is six
 * applications for the cost of one registration. Biggest group first.
 */

import fs from 'node:fs';
import path from 'node:path';
import { localToday } from '../lib/local-today.mjs';

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

// Alex ruled out TRADING, not the firms. Excluding by company name threw away
// ~20 genuine engineering roles at Chicago's most selective employers -- DV
// Trading's AI Engineer Intern, Geneva's AI and Data Engineer Interns, Citadel
// and Jump and IMC and Hudson River SWE internships -- because the company was
// on the list. Reinstated 2026-09-26 at his direction ("it's an ai engineer and
// infra, might as well try for some of these").
//
// So the firm list below no longer excludes anything on its own. It marks a
// company as a trading shop; what gets dropped is the ROLE.
const HFT = /akuna|optiver|belvedere|jump ?trading|hudson ?river|imc|drw|citadel|jane ?street|old ?mission|chicago ?trading|transmarket|aquatic|peak6|wolverine|dv ?trading|geneva ?trading|cboe|xr ?trading|group ?one|headlands|tower ?research|five ?rings/i;

// Company names arrive from two places -- a tracker row ("Chicago Trading Company")
// and an ATS tenant slug ("chicagotradingcampus") -- and the slug has no spaces, so
// a pattern written with them matched the first and missed the second. Tested
// against BOTH the raw name and a despaced copy. Same class of bug as "full stack"
// missing "Full-Stack" in target-list.
const isHft = (name) => HFT.test(String(name ?? '')) || HFT.test(String(name ?? '').replace(/[^a-z0-9]+/gi, ''));

// The desk itself, and the two things he named separately: quant research and
// C++-heavy work. "C++ or Python" is NOT C++-heavy, so the exclusion requires
// C++ without Python beside it.
const DESK_ROLE = /\bquant|\btrader\b|trading analyst|\bfpga\b|hardware engineer/i;
const CPP_HEAVY = (t) => /\bc\+\+/i.test(t) && !/python/i.test(t);

// A trading firm's engineering roles stay; its desk roles go.
const excluded = (row) => isHft(row.company) && (DESK_ROLE.test(row.role) || CPP_HEAVY(row.role));

function tenantOf(row) {
  const u = row.url;
  let m = /^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs/i.exec(u);
  if (m) return `Workday · ${m[1]}`;
  m = /^https?:\/\/(wd\d+)\.myworkdaysite\.com\/recruiting\/([^/]+)/i.exec(u);
  if (m) return `Workday · ${m[2]}`;
  m = /^https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)/i.exec(u);
  if (m) return `Greenhouse · ${m[1]}`;
  m = /^https?:\/\/jobs\.lever\.co\/([^/?#]+)/i.exec(u);
  if (m) return `Lever · ${m[1]}`;
  m = /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i.exec(u);
  if (m) return `Ashby · ${m[1]}`;
  m = /^https?:\/\/([a-z0-9-]+)\.icims\.com/i.exec(u);
  if (m) return `iCIMS · ${m[1]}`;
  if (/oraclecloud\.com/i.test(u)) return `Oracle · ${row.company}`;
  m = /smartrecruiters\.com\/([^/?#]+)/i.exec(u);
  if (m) return `SmartRecruiters · ${m[1]}`;
  return row.company;
}

const src = arg('--in', 'data/targets.md');
const out = arg('--out', 'data/apply-run.md');
const title = arg('--title', 'Apply run');

const srcLines = fs.readFileSync(path.resolve(src), 'utf8').split('\n');

// Columns are resolved by HEADER NAME, not by position. target-list.mjs emits an
// `elig` column only under --check-eligibility, so a fixed index read the URL
// one cell left on a list built without it -- every row came back with no URL,
// was filtered out, and the run sheet printed "0 roles" over a full list.
const header = srcLines.find((l) => /^\|\s*#\s*\|/.test(l));
const cols = {};
if (header) {
  header.split('|').map((s) => s.trim().toLowerCase()).forEach((h, i) => { if (h && !(h in cols)) cols[h] = i; });
}
const at = (c, name, fallback) => {
  const i = cols[name];
  return i != null ? (c[i] ?? '') : (fallback != null ? (c[fallback] ?? '') : '');
};

const rows = srcLines
  .filter((l) => /^\| \d+/.test(l))
  .map((l) => {
    const c = l.split('|').map((s) => s.trim());
    return {
      company: at(c, 'company', 2),
      role: at(c, 'role', 3),
      location: at(c, 'where', 4),
      resume: at(c, 'resume', 5),
      elig: at(c, 'elig'),
      url: at(c, 'link', c.length - 2),
    };
  })
  .filter((r) => r.url && !excluded(r));

const groups = new Map();
for (const r of rows) {
  const t = tenantOf(r);
  if (!groups.has(t)) groups.set(t, []);
  groups.get(t).push(r);
}
const ordered = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

const lines = [
  // localToday, not toISOString: an evening run west of UTC headed the sheet
  // with tomorrow's date.
  `# ${title} — ${localToday()}`,
  '',
  `${rows.length} roles, grouped by ATS tenant. One account covers every role under a`,
  'heading, so working a group straight through pays the signup once rather than once',
  'per posting. Biggest group first.',
  '',
  'Attach the PDF named on each row from `output/apply-pack/`.',
  '`✓` = the posting states a graduation window and your MS fits it; blank = it states none.',
  '',
];
let n = 1;
for (const [tenant, list] of ordered) {
  lines.push(`## ${tenant}  (${list.length})`, '');
  for (const r of list) {
    lines.push(`- [ ] **${n++}.** ${r.company} — ${r.role}${r.elig === '✓' ? '  ✓' : ''}`);
    lines.push(`      \`Alex-Doe-${r.resume}.pdf\`  ·  ${r.location}`);
    lines.push(`      ${r.url}`);
  }
  lines.push('');
}
fs.writeFileSync(path.resolve(out), lines.join('\n') + '\n');
console.log(`${out}: ${rows.length} roles across ${ordered.length} tenants`);
console.log('largest: ' + ordered.slice(0, 6).map(([t, l]) => `${t} (${l.length})`).join(', '));
