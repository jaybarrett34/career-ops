#!/usr/bin/env node
/**
 * pretriage.mjs — cut a scan backlog down to a list a human can actually read.
 *
 * THE PROBLEM THIS SOLVES
 *
 * A scan appends; nothing ever retires a row. data/pipeline.md reached 2,856
 * unchecked entries, which is not a queue — it is an archive nobody opens, and
 * a role that closes while sitting in it was never really in the pipeline at
 * all. `triage` mode reads rows with an LLM, so it cannot be pointed at 2,856 of
 * them either.
 *
 * Everything here is deterministic and free: re-apply the CURRENT filters (a row
 * added before a filter tightened is still in the file), collapse duplicates,
 * then rank. No network, no model.
 *
 * WHY RE-FILTERING MATTERS MORE THAN IT SOUNDS
 *
 * portals.yml is edited as the search sharpens. Rows added under the old filters
 * keep whatever the filters said the day they landed, so the backlog is a
 * sediment of every past version of the targeting. Replaying today's filters
 * over the whole file is the only way the current answer applies to all of it.
 *
 * NOTHING IS DELETED. Rows that lose are marked done (`- [x]`) with the reason
 * appended, so the decision is auditable and reversible with an editor.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { buildTitleFilter, buildLocationFilter, loadBlacklist, atomicWriteFile, PIPELINE_PATH, PORTALS_PATH } from './scan.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { companyKey } from './lib/discovered.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(n);

/**
 * One `- [ ] url | company | title | location | posted: ... ` row.
 *
 * `index` is the row's identity for decisions. The URL is NOT: the real file
 * holds 41 URLs written twice, so a reasons map keyed by URL lets a rejected
 * copy's verdict land on the shortlisted copy, silently marking a good row done.
 */
export function parseRow(line, index = -1) {
  const m = /^- \[( |x)\]\s*(.*)$/.exec(line);
  if (!m) return null;
  const segs = m[2].split(' | ').map((s) => s.trim());
  const url = segs[0] || '';
  if (!/^https?:\/\//i.test(url)) return null;
  const posted = segs.find((s) => s.startsWith('posted:'));
  return {
    index,
    done: m[1] === 'x',
    url,
    company: segs[1] || '',
    title: segs[2] || '',
    // Location is the first unlabeled segment after the title; the labeled ones
    // (posted:, sponsorship:) are appended by the scanners in any order.
    location: segs.slice(3).find((s) => !/^[a-z]+:/.test(s)) || '',
    postedAt: posted ? posted.slice(7).trim() : '',
    raw: line,
  };
}

/**
 * Collapse rows that are the same opening.
 *
 * Two shapes are both present in real data and neither is caught by URL
 * equality: the same requisition published on two of an employer's own Workday
 * sites (Boeing's EXTERNAL_CAREERS and INTERN tenants carry one JR number), and
 * one employer spelled differently by two scanners ("Akuna Capital University"
 * from the Simplify feed, "akunacapital" from the board slug). Keying on the
 * normalized company plus the normalized title catches both.
 */
export function dedupKey(row) {
  const title = row.title.toLowerCase()
    .replace(/\bsummer\s*20\d\d\b|\b20\d\d\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${companyKey(row.company)}::${title}`;
}

// "Remote" alone is not a location. A backlog holds "Remote UK" and "Colombia -
// Remote", which the location filter's `allow: Remote` lets through and which
// are useless to a US candidate; remote only counts when something says US.
const US_REMOTE = /\bremote\b/i;
const NON_US = /\b(uk|united kingdom|emea|apac|latam|canada|india|germany|poland|colombia|mexico|brazil|argentina|spain|portugal|netherlands|ireland|australia|singapore|japan)\b/i;

// The early-career positives in portals.yml ("word:Intern", "Internship",
// "Summer Analyst" ...) are domain-agnostic ON PURPOSE -- they have to be, or a
// differently-worded engineering internship would be missed. The cost is that
// they also admit Preconstruction Intern and Commercial Strategy Intern. Ranking
// is where that gets paid back: a title is boosted when it ALSO matches one of
// the domain positives, so the same config that finds the rows orders them.
export const EARLY_CAREER_KEYWORDS = new Set([
  'word:intern', 'internship', 'summer analyst', 'summer associate', 'summer technology',
  'summer 2027', '2027 summer', 'word:co-op', 'word:coop', 'early career',
  'university graduate', 'campus hire', 'rotational program',
]);

/** The domain half of title_filter.positive, with the catch-alls removed. */
export function domainKeywords(titleFilter) {
  return (titleFilter?.positive ?? [])
    .filter((k) => typeof k === 'string' && !EARLY_CAREER_KEYWORDS.has(k.trim().toLowerCase()));
}

/** Is this an internship or other early-career posting? */
export function isEarlyCareer(title) {
  return /\b(intern|internship|co-?op|new ?grad|university ?graduate|campus|early ?career|summer (analyst|associate))\b/i.test(title);
}

/**
 * Higher sorts first.
 *
 * TERM dominates everything else. The first version ranked on location and
 * recency alone and handed back a shortlist of full-time remote senior roles --
 * "Founding Product FullStack Engineer", "Technical Account Manager, Remote UK"
 * -- because a fresh remote posting outscored a Chicago internship. For a
 * candidate searching one specific term, a posting of the wrong term is not a
 * weaker match; it is not a match.
 */
export function score(row, { near, term, domain = null }) {
  let s = 0;
  const loc = row.location.toLowerCase();

  if (isEarlyCareer(row.title)) s += 400;
  // A Preconstruction Intern and a Software Engineer Intern both clear the
  // early-career gate; only one of them is this search.
  if (domain && domain(row.title)) s += 250;
  if (term && term.test(row.title)) s += 200;

  if (near.some((n) => loc.includes(n))) s += 100;
  else if (US_REMOTE.test(loc) && !NON_US.test(loc)) s += 40;
  if (NON_US.test(loc) && !near.some((n) => loc.includes(n))) s -= 200;

  if (row.postedAt) {
    const age = (Date.now() - Date.parse(row.postedAt)) / 86400_000;
    if (Number.isFinite(age)) s += Math.max(0, 60 - age); // a month-old posting is worth about half a fresh one
  }
  return s;
}

export function pretriage(rows, { titleFilter, locationFilter, blacklist, near, keep, term = null, earlyCareerOnly = false, domain = null, domainOnly = false }) {
  const reasons = new Map();
  const survivors = [];
  const seen = new Map();

  for (const r of rows) {
    if (r.done) continue;
    if (titleFilter && !titleFilter(r.title)) { reasons.set(r.index, 'title filter'); continue; }
    if (locationFilter && r.location && !locationFilter(r.location)) { reasons.set(r.index, 'location filter'); continue; }
    if (blacklist?.has(normalizeCompany(r.company))) { reasons.set(r.index, 'blacklist'); continue; }
    if (earlyCareerOnly && !isEarlyCareer(r.title)) { reasons.set(r.index, 'not an early-career posting'); continue; }
    if (domainOnly && domain && !domain(r.title)) { reasons.set(r.index, 'off-domain title'); continue; }
    const k = dedupKey(r);
    const prev = seen.get(k);
    if (prev) {
      // Keep whichever copy the ranking prefers, so a dedup never costs the
      // better row.
      if (score(r, { near, term, domain }) > score(prev, { near, term, domain })) {
        reasons.set(prev.index, 'duplicate opening');
        seen.set(k, r);
        survivors[survivors.indexOf(prev)] = r;
      } else {
        reasons.set(r.index, 'duplicate opening');
      }
      continue;
    }
    seen.set(k, r);
    survivors.push(r);
  }

  survivors.sort((a, b) => score(b, { near, term, domain }) - score(a, { near, term, domain }));
  const shortlist = survivors.slice(0, keep);
  for (const r of survivors.slice(keep)) reasons.set(r.index, 'below the shortlist cut');
  return { shortlist, reasons };
}

function main() {
  if (flag('--help') || flag('-h')) {
    console.log(`Cut data/pipeline.md down to a readable shortlist. Deterministic, no model, no network.

  node pretriage.mjs --dry-run            # show what would happen
  node pretriage.mjs --keep 200           # shortlist size (default 200)
  node pretriage.mjs --near "chicago,tucson,phoenix,arizona,illinois"
  node pretriage.mjs --early-career          # drop anything that is not an intern/co-op/new-grad row
  node pretriage.mjs --term "summer 2027"    # bonus for the term you are actually searching
  node pretriage.mjs --on-domain             # drop titles that match no domain keyword in portals.yml
  node pretriage.mjs                      # apply: losers become - [x] with a reason

Nothing is deleted. Losing rows are marked done with the reason appended.`);
    return;
  }

  const keep = Number(arg('--keep', '200')) || 200;
  const near = String(arg('--near', 'chicago,tucson,phoenix,arizona,illinois,remote'))
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const dryRun = flag('--dry-run');
  const termArg = arg('--term');
  const term = termArg ? new RegExp(termArg.replace(/\s+/g, '\\s*'), 'i') : null;
  const earlyCareerOnly = flag('--early-career');
  const domainOnly = flag('--on-domain');

  const cfg = yaml.load(fs.readFileSync(PORTALS_PATH, 'utf8')) || {};
  const titleFilter = cfg.title_filter ? buildTitleFilter(cfg.title_filter) : null;
  const locationFilter = cfg.location_filter ? buildLocationFilter(cfg.location_filter) : null;
  const blacklist = loadBlacklist();
  const domainWords = domainKeywords(cfg.title_filter);
  const domain = domainWords.length ? buildTitleFilter({ positive: domainWords, negative: cfg.title_filter?.negative }) : null;

  const src = fs.readFileSync(PIPELINE_PATH, 'utf8');
  const lines = src.split('\n');
  const rows = lines.map((l, i) => parseRow(l, i)).filter(Boolean);
  const open = rows.filter((r) => !r.done);

  const { shortlist, reasons } = pretriage(rows, { titleFilter, locationFilter, blacklist, near, keep, term, earlyCareerOnly, domain, domainOnly });

  const tally = {};
  for (const why of reasons.values()) tally[why] = (tally[why] || 0) + 1;

  console.log(`${open.length} open rows -> ${shortlist.length} shortlisted`);
  for (const [why, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${why}`);
  }
  console.log('\nTop of the shortlist:');
  for (const r of shortlist.slice(0, 15)) {
    console.log(`  ${r.postedAt || '?'.padEnd(10)}  ${r.company} | ${r.title} | ${r.location}`);
  }

  if (dryRun) return console.log('\n(dry run: nothing written)');

  const out = lines.map((line, i) => {
    const r = parseRow(line, i);
    if (!r || r.done) return line;
    const why = reasons.get(i);
    return why ? `- [x] ${line.slice(6)} | pretriage: ${why}` : line;
  });
  atomicWriteFile(PIPELINE_PATH, out.join('\n'));
  console.log(`\nMarked ${reasons.size} rows done in ${path.basename(PIPELINE_PATH)}. Nothing was deleted.`);
}

if (isMainModule(import.meta.url)) main();
