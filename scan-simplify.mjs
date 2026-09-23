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
  loadSeenUrls, atomicWriteFile, loadBlacklist,
  sanitizeMarkdownField, sanitizeTsvField,
  SCAN_HISTORY_PATH, PIPELINE_PATH, PORTALS_PATH,
} from './scan.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import {
  companyKey, isSharedHost, normalizeDiscovered, mergeDiscoveries, toYaml, promotionCandidates,
} from './lib/discovered.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

export const DISCOVERED_PATH = path.join(getCareerOpsRoot(), 'config/discovered.yml');

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
  node scan-simplify.mjs                      # all lists, postings from the last 90 days
  node scan-simplify.mjs --list summer2027    # one list (${Object.keys(LISTS).join(', ')})
  node scan-simplify.mjs --since 30           # widen the posting window
  node scan-simplify.mjs --dry-run            # preview, write nothing
  node scan-simplify.mjs --limit 50           # cap the results written
  node scan-simplify.mjs --include-inactive   # include listings Simplify marks closed
  node scan-simplify.mjs --include-blacklisted # let data/blacklist.md matches through
  node scan-simplify.mjs --no-discover        # skip the config/discovered.yml ledger
  node scan-simplify.mjs --promote            # append discovered entries marked promoted: true to portals.yml
  node scan-simplify.mjs --json               # machine-readable result on stdout (implies --dry-run)`);
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

/**
 * Move every `promoted: true` entry in config/discovered.yml into portals.yml
 * tracked_companies.
 *
 * The ledger's header tells the reader to set that flag, so something has to
 * honor it; a flag the user sets and nothing reads is worse than no flag. The
 * host recorded on the entry becomes careers_url, which is a starting point and
 * not a verified board -- run audit-portals.mjs afterwards, since a company's
 * own domain is frequently a marketing page with no provider behind it.
 */
function promote() {
  let map;
  try {
    map = normalizeDiscovered(yaml.load(fs.readFileSync(DISCOVERED_PATH, 'utf8')));
  } catch {
    console.error(`No ledger at ${DISCOVERED_PATH}. Run a scan first.`);
    process.exit(1);
  }
  // A dismissed entry is a decision not to track the company; promoting one
  // would be the flag quietly overriding the lock.
  const picked = [...map.values()].filter((r) => r.promoted && r.lock !== 'dismissed');
  const refused = [...map.values()].filter((r) => r.promoted && r.lock === 'dismissed');
  for (const r of refused) console.log(`Skipping ${r.company}: marked promoted but also dismissed.`);
  if (!picked.length) return console.log('Nothing marked promoted: true.');

  const src = fs.readFileSync(PORTALS_PATH, 'utf8');
  const cfg = yaml.load(src) || {};
  const already = new Set((cfg.tracked_companies || [])
    .map((c) => companyKey(typeof c === 'string' ? c : c?.name)).filter(Boolean));

  const lines = [];
  for (const r of picked) {
    if (already.has(companyKey(r.company))) continue;
    // A shared ATS host is the vendor's domain, not the company's, so it is not
    // a careers_url worth writing.
    const host = r.hosts.find((h) => !isSharedHost(h));
    lines.push(`  - name: ${r.company}`);
    lines.push(`    careers_url: https://${host || 'EDIT-ME'}/`);
    lines.push(`    # promoted from config/discovered.yml, seen ${r.count}x${host ? '' : ' -- no own domain recorded, fill in'}`);
  }
  if (!lines.length) return console.log('Every promoted entry is already in tracked_companies.');

  // Appended at the end of the file rather than spliced into the block: the
  // block carries hand-written grouping comments that a reserializing YAML
  // round-trip would destroy.
  atomicWriteFile(PORTALS_PATH, `${src.replace(/\s*$/, '')}\n\n  # ── Promoted from a scan ──\n${lines.join('\n')}\n`);
  // Promoted entries stay in the ledger with their history; the name check above
  // is what keeps a second --promote from duplicating them.
  console.log(`Appended ${lines.length / 3} compan${lines.length === 3 ? 'y' : 'ies'} to portals.yml tracked_companies.`);
  console.log('Run `node audit-portals.mjs` to check each careers_url resolves to a real board.');
}

async function main() {
  if (flag('--help') || flag('-h')) return usage();
  if (flag('--promote')) return promote();

  const which = arg('--list');
  if (which && !LISTS[which]) {
    console.error(`Unknown list "${which}". Known: ${Object.keys(LISTS).join(', ')}`);
    process.exit(1);
  }
  const chosen = which ? [which] : Object.keys(LISTS);
  // 90 days, not 7. Late in a hiring cycle a posting from three months ago is
  // still open, and a one-week default hid most of the live market from every
  // run -- the failure looked like "nothing new" rather than "wrong window".
  const sinceDays = Number(arg('--since', '90'));
  const cutoffMs = Number.isFinite(sinceDays) && sinceDays > 0 ? Date.now() - sinceDays * 86400_000 : null;
  const limit = Number(arg('--limit', '0')) || Infinity;
  // --json implies --dry-run: a caller parsing stdout wants the candidates, not
  // a side effect on the user's pipeline. Making it write as well would mean the
  // UI's "preview" silently mutated data/pipeline.md.
  const asJson = flag('--json');
  const dryRun = flag('--dry-run') || asJson;
  const includeInactive = flag('--include-inactive');
  const includeBlacklisted = flag('--include-blacklisted');
  const discover = !flag('--no-discover');

  let cfg = {};
  try {
    cfg = yaml.load(fs.readFileSync(PORTALS_PATH, 'utf8')) || {};
  } catch {
    console.error('portals.yml not found or unreadable; running with no filters.');
  }
  const titleFilter = cfg.title_filter ? buildTitleFilter(cfg.title_filter) : null;
  const locationFilter = cfg.location_filter ? buildLocationFilter(cfg.location_filter) : null;
  const contentFilter = cfg.content_filter ? buildContentFilter(cfg.content_filter) : null;
  // Two sources, one gate. portals.yml blacklist_companies is this scanner's
  // original list; data/blacklist.md is the do-not-apply file scan.mjs honors,
  // and a company the user refuses has not become acceptable by arriving through
  // a different scanner.
  const blacklist = loadBlacklist();
  for (const c of cfg.blacklist_companies || []) {
    const k = normalizeCompany(String(c));
    if (k && !blacklist.has(k)) blacklist.set(k, { company: String(c), reason: 'portals.yml' });
  }
  // Companies portals.yml already tracks are not discoveries.
  const tracked = new Set((cfg.tracked_companies || [])
    .map((c) => companyKey(typeof c === 'string' ? c : c?.name))
    .filter(Boolean));

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
      const blEntry = blacklist.get(normalizeCompany(company));
      if (blEntry && !includeBlacklisted) { filtered++; continue; }
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
        blacklisted: blEntry ? (blEntry.reason || 'on your do-not-apply list') : '',
      });
      kept++;
      if (rows.length >= limit) break;
    }
    // stderr in --json mode so stdout stays a single parseable document.
    (asJson ? console.error : console.log)(`  ${spec.label}: ${listings.length} listings, ${kept} new match${kept === 1 ? '' : 'es'}`);
    if (rows.length >= limit) break;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      scanned, filteredOut: staleOrClosed + filtered, alreadySeen: dupes,
      offers: rows.map((r) => ({
        url: r.url, company: r.company, title: r.title,
        location: r.location, ats: r.portal, postedAt: r.postedAt,
        sponsorship: r.sponsorship, blacklisted: r.blacklisted || undefined,
      })),
      discovered: discover ? recordDiscoveries(rows, tracked, { dryRun: true }).map((d) => ({
        company: d.company, count: d.count, hosts: d.hosts,
      })) : [],
    }) + '\n');
    return;
  }

  console.log(`\nScanned ${scanned} listings across ${chosen.length} list(s).`);
  console.log(`  filtered out: ${staleOrClosed} (closed/stale/off-target), ${filtered} (blacklist/content)`);
  console.log(`  already seen: ${dupes}`);
  console.log(`  NEW: ${rows.length}`);

  if (!rows.length) return;
  if (dryRun) {
    if (discover) reportDiscoveries(recordDiscoveries(rows, tracked, { dryRun: true }));
    for (const r of rows.slice(0, 40)) {
      console.log(`  + [${r.portal}] ${r.postedAt || '?'} | ${r.company} | ${r.title} | ${r.location}${r.blacklisted ? ` [BLACKLISTED: ${r.blacklisted}]` : ''}`);
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
  if (discover) reportDiscoveries(recordDiscoveries(rows, tracked, { dryRun: false }));
}

/**
 * Fold this run's companies into config/discovered.yml and return the entries
 * now worth promoting.
 *
 * The ledger is per data root, so each profile accumulates its own map of where
 * its roles come from. That map is the only thing a root with no portals.yml
 * has to build one from.
 */
function recordDiscoveries(rows, tracked, { dryRun }) {
  let existing = new Map();
  try {
    existing = normalizeDiscovered(yaml.load(fs.readFileSync(DISCOVERED_PATH, 'utf8')));
  } catch { /* absent or unreadable: start from nothing */ }
  const { merged } = mergeDiscoveries(existing, rows, {
    known: tracked,
    today: new Date().toISOString().slice(0, 10),
    source: 'simplify',
  });
  if (!dryRun) {
    fs.mkdirSync(path.dirname(DISCOVERED_PATH), { recursive: true });
    atomicWriteFile(DISCOVERED_PATH, toYaml(merged));
  }
  return promotionCandidates(merged);
}

function reportDiscoveries(candidates) {
  if (!candidates.length) return;
  console.log(`\n${candidates.length} untracked compan${candidates.length === 1 ? 'y has' : 'ies have'} come up more than once:`);
  for (const c of candidates.slice(0, 15)) {
    console.log(`  ${String(c.count).padStart(3)}x  ${c.company}${c.hosts.length ? `  (${c.hosts[0]})` : ''}`);
  }
  if (candidates.length > 15) console.log(`  ... and ${candidates.length - 15} more`);
  console.log('Set promoted: true in config/discovered.yml to move one into portals.yml.');
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
