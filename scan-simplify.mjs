#!/usr/bin/env node
/**
 * scan-simplify.mjs — zero-token scanner over the SimplifyJobs public lists.
 *
 * SimplifyJobs maintains community-curated GitHub repos of internship and
 * new-grad postings, each publishing a machine-readable listings.json. This
 * reads those directly: one HTTPS GET per list, no browser, no LLM, no auth.
 *
 * WHY THIS IS A SEPARATE SCANNER RATHER THAN AN `--ats` SOURCE
 *
 * scan-ats-full.mjs's SOURCES iterate a directory of COMPANY SLUGS and then
 * fetch each company's board. Simplify publishes a flat list of JOBS that have
 * already been aggregated across boards, so there is no slug to iterate and no
 * per-company fetch to make. Forcing it into that shape would mean inventing
 * synthetic company entries for something that is already the end product.
 *
 * TRUST POSTURE
 *
 * These listings are community-maintained third-party data, which makes every
 * field UNTRUSTED CONTENT under AGENTS.md: read for content, never obeyed. In
 * practice that means nothing here is executed, no field is used to build a
 * filesystem path, and titles and company names are sanitized before they reach
 * pipeline.md or scan-history.tsv, where an unescaped pipe or newline would
 * corrupt the table the rest of the toolchain parses.
 *
 * Postings are filtered through the SAME portals.yml title/location/content
 * filters as every other scanner, so a role that would be rejected from a
 * company board is rejected here too.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import {
  buildTitleFilter, buildLocationFilter, buildContentFilter,
  loadSeenUrls, atomicWriteFile,
  sanitizeMarkdownField, sanitizeTsvField,
  SCAN_HISTORY_PATH, PIPELINE_PATH, PORTALS_PATH,
} from './scan.mjs';

/** The lists, and the term each one is scanned for. */
export const LISTS = {
  summer2027: {
    label: 'Simplify Summer 2027 Internships',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json',
    // A repo named for one season still carries earlier terms, so the term
    // filter is what actually scopes the year, not the repo name.
    term: /summer\s*2027/i,
    portal: 'simplify-summer2027',
  },
  summer2026: {
    label: 'Simplify Summer 2026 Internships',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
    term: /summer\s*2026/i,
    portal: 'simplify-summer2026',
  },
  newgrad: {
    label: 'Simplify New Grad Positions',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
    term: null, // new-grad listings carry no season term
    portal: 'simplify-newgrad',
  },
};

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes(name);

function usage() {
  console.log(`Usage:
  node scan-simplify.mjs                      # all lists, postings from the last 7 days
  node scan-simplify.mjs --list summer2027    # one list (${Object.keys(LISTS).join(', ')})
  node scan-simplify.mjs --since 30           # widen the posting window
  node scan-simplify.mjs --dry-run            # preview, write nothing
  node scan-simplify.mjs --limit 50           # cap the results written
  node scan-simplify.mjs --include-inactive   # include listings Simplify marks closed`);
}

/** Locations arrive as an array; the shared location filter wants a string. */
export function locationText(listing) {
  const l = listing?.locations;
  if (Array.isArray(l)) return l.filter((x) => typeof x === 'string').join(' · ');
  return typeof l === 'string' ? l : '';
}

/**
 * Decide whether one listing survives.
 *
 * Exported so tests can drive it without a network call, which is the only way
 * to assert the filters actually reject anything.
 */
export function keepListing(listing, { term, titleFilter, locationFilter, cutoffMs, includeInactive }) {
  if (!listing || typeof listing !== 'object') return false;
  if (!includeInactive && listing.active !== true) return false;
  if (listing.is_visible === false) return false;
  const title = typeof listing.title === 'string' ? listing.title : '';
  const url = typeof listing.url === 'string' ? listing.url : '';
  if (!title || !/^https?:\/\//i.test(url)) return false;
  if (term) {
    const terms = Array.isArray(listing.terms) ? listing.terms : [];
    if (!terms.some((t) => typeof t === 'string' && term.test(t))) return false;
  }
  if (cutoffMs !== null) {
    const posted = Number(listing.date_posted);
    // A missing or junk timestamp is KEPT rather than dropped: the window is a
    // relevance heuristic, and silently discarding undated postings would hide
    // real roles with no signal that it happened.
    if (Number.isFinite(posted) && posted > 0 && posted * 1000 < cutoffMs) return false;
  }
  if (titleFilter && !titleFilter(title)) return false;
  if (locationFilter && !locationFilter(locationText(listing))) return false;
  return true;
}

async function fetchList(spec) {
  const res = await fetch(spec.url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${spec.label}: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`${spec.label}: expected an array`);
  return data;
}

async function main() {
  if (flag('--help') || flag('-h')) return usage();

  const which = arg('--list');
  if (which && !LISTS[which]) {
    console.error(`Unknown list "${which}". Known: ${Object.keys(LISTS).join(', ')}`);
    process.exit(1);
  }
  const chosen = which ? [which] : Object.keys(LISTS);
  const sinceDays = Number(arg('--since', '7'));
  const cutoffMs = Number.isFinite(sinceDays) && sinceDays > 0 ? Date.now() - sinceDays * 86400_000 : null;
  const limit = Number(arg('--limit', '0')) || Infinity;
  const dryRun = flag('--dry-run');
  const includeInactive = flag('--include-inactive');

  let cfg = {};
  try {
    cfg = yaml.load(fs.readFileSync(PORTALS_PATH, 'utf8')) || {};
  } catch {
    console.error('portals.yml not found or unreadable; running with no filters.');
  }
  const titleFilter = cfg.title_filter ? buildTitleFilter(cfg.title_filter) : null;
  const locationFilter = cfg.location_filter ? buildLocationFilter(cfg.location_filter) : null;
  const contentFilter = cfg.content_filter ? buildContentFilter(cfg.content_filter) : null;
  const blacklist = new Set((cfg.blacklist_companies || []).map((c) => String(c).toLowerCase().trim()));

  // loadSeenUrls() returns { seen, recheckEligible }, not a bare Set.
  const { seen } = loadSeenUrls();
  const rows = [];
  let scanned = 0, staleOrClosed = 0, filtered = 0, dupes = 0;

  for (const key of chosen) {
    const spec = LISTS[key];
    let listings;
    try {
      listings = await fetchList(spec);
    } catch (e) {
      console.error(`  ${spec.label}: ${e.message}`);
      continue;
    }
    scanned += listings.length;
    let kept = 0;
    for (const l of listings) {
      if (!keepListing(l, { term: spec.term, titleFilter, locationFilter, cutoffMs, includeInactive })) {
        staleOrClosed++;
        continue;
      }
      const company = typeof l.company_name === 'string' ? l.company_name : '';
      if (blacklist.has(company.toLowerCase().trim())) { filtered++; continue; }
      if (contentFilter && !contentFilter(`${l.title} ${company}`)) { filtered++; continue; }
      if (seen.has(l.url)) { dupes++; continue; }
      seen.add(l.url);
      rows.push({
        url: l.url,
        company,
        title: l.title,
        location: locationText(l),
        portal: spec.portal,
        postedAt: Number.isFinite(Number(l.date_posted)) && Number(l.date_posted) > 0
          ? new Date(Number(l.date_posted) * 1000).toISOString().slice(0, 10) : '',
        sponsorship: typeof l.sponsorship === 'string' ? l.sponsorship : '',
      });
      kept++;
      if (rows.length >= limit) break;
    }
    console.log(`  ${spec.label}: ${listings.length} listings, ${kept} new match${kept === 1 ? '' : 'es'}`);
    if (rows.length >= limit) break;
  }

  console.log(`\nScanned ${scanned} listings across ${chosen.length} list(s).`);
  console.log(`  filtered out: ${staleOrClosed} (closed/stale/off-target), ${filtered} (blacklist/content)`);
  console.log(`  already seen: ${dupes}`);
  console.log(`  NEW: ${rows.length}`);

  if (!rows.length) return;
  if (dryRun) {
    for (const r of rows.slice(0, 40)) {
      console.log(`  + [${r.portal}] ${r.postedAt || '?'} | ${r.company} | ${r.title} | ${r.location}`);
      console.log(`    ${r.url}`);
    }
    if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);
    console.log('\n(dry run: nothing written)');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const pipeLines = rows.map((r) => {
    const segs = [r.url, sanitizeMarkdownField(r.company), sanitizeMarkdownField(r.title)];
    if (r.location) segs.push(sanitizeMarkdownField(r.location));
    if (r.postedAt) segs.push(`posted: ${r.postedAt}`);
    // Sponsorship is the field most likely to disqualify a posting outright,
    // and it is cheap to carry, so it rides along as a labeled segment.
    if (r.sponsorship) segs.push(`sponsorship: ${sanitizeMarkdownField(r.sponsorship)}`);
    return `- [ ] ${segs.join(' | ')}`;
  });
  const prior = fs.existsSync(PIPELINE_PATH) ? fs.readFileSync(PIPELINE_PATH, 'utf8').replace(/\s*$/, '') : '# Pipeline';
  atomicWriteFile(PIPELINE_PATH, `${prior}\n${pipeLines.join('\n')}\n`);

  const histHeader = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company';
  const histLines = rows.map((r) => [
    r.url, today, r.portal, sanitizeTsvField(r.title), sanitizeTsvField(r.company), 'added',
    sanitizeTsvField(r.location), '', r.postedAt, '', '', sanitizeTsvField(r.company.toLowerCase()),
  ].join('\t'));
  const priorHist = fs.existsSync(SCAN_HISTORY_PATH)
    ? fs.readFileSync(SCAN_HISTORY_PATH, 'utf8').replace(/\s*$/, '')
    : histHeader;
  atomicWriteFile(SCAN_HISTORY_PATH, `${priorHist}\n${histLines.join('\n')}\n`);

  console.log(`\nWrote ${rows.length} to data/pipeline.md and data/scan-history.tsv.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
