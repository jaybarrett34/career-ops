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

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

// Ruled out by Jay: "no way Im good for trading" and C++-heavy. They match on
// title and location, so they must be excluded by NAME or they dominate a
// Chicago list.
const HFT = /akuna|optiver|belvedere|jump trading|hudson river|imc|drw|citadel|jane street|old mission|chicago trading|transmarket|aquatic|peak6|wolverine|dv trading|geneva trading|cboe|xr trading|group one|headlands|tower research|five rings/i;

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

const rows = fs.readFileSync(path.resolve(src), 'utf8').split('\n')
  .filter((l) => /^\| \d+/.test(l))
  .map((l) => {
    const c = l.split('|').map((s) => s.trim());
    return { company: c[2], role: c[3], location: c[4], resume: c[5], elig: c[8], url: c[9] };
  })
  .filter((r) => r.url && !HFT.test(r.company));

const groups = new Map();
for (const r of rows) {
  const t = tenantOf(r);
  if (!groups.has(t)) groups.set(t, []);
  groups.get(t).push(r);
}
const ordered = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

const lines = [
  `# ${title} — ${new Date().toISOString().slice(0, 10)}`,
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
    lines.push(`      \`Jay Barrett — ${r.resume}.pdf\`  ·  ${r.location}`);
    lines.push(`      ${r.url}`);
  }
  lines.push('');
}
fs.writeFileSync(path.resolve(out), lines.join('\n') + '\n');
console.log(`${out}: ${rows.length} roles across ${ordered.length} tenants`);
console.log('largest: ' + ordered.slice(0, 6).map(([t, l]) => `${t} (${l.length})`).join(', '));
