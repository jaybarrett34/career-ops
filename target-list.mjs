#!/usr/bin/env node
/**
 * target-list.mjs — rank the pipeline against EVERY resume you have.
 *
 * WHY THIS EXISTS
 *
 * `pretriage.mjs` ranks against one archetype's keywords, so a listing that is a
 * strong data-engineering match scores badly when the active archetype is swe.
 * But the candidate has eight resumes. A posting only has to fit ONE of them to
 * be worth applying to, and which one it fits is the useful output — it tells
 * you what to send, not just whether to bother.
 *
 * So: build a vocabulary per archetype from that resume's own bullets and skills
 * line, score every row against all of them, and report the best fit plus the
 * margin over the runner-up. A row with a clear winner is an easy decision; a
 * row where three archetypes tie is one where positioning matters.
 *
 * Zero tokens: the vocabularies come from config/bullets.yml and the templates,
 * and matching is the same word-boundary check the tailor uses.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateLibrary, selectBullets } from './lib/bullets.mjs';
import { covers } from './lib/tailor.mjs';
import { parseRow, isEarlyCareer } from './pretriage.mjs';
import { eligibility } from './lib/eligibility.mjs';

const ROOT = getCareerOpsRoot();
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(n);

/**
 * Companies whose name alone changes how an application is worth treating.
 *
 * Not a quality judgement about the work — it is about SELECTIVITY and what a
 * line on a resume signals later. Kept as data rather than inferred from any
 * score, because there is no signal in a job posting that means "this is Apple".
 */
const TIER1 = /^(google|alphabet|apple|amazon|meta|microsoft|netflix|nvidia|openai|anthropic|databricks|stripe|airbnb|uber|lyft|linkedin|salesforce|adobe|oracle|ibm|intel|amd|qualcomm|broadcom|tesla|spacex|palantir|snowflake|datadog|cloudflare|atlassian|shopify|square|block|coinbase|doordash|instacart|pinterest|snap|spotify|twilio|figma|notion|roblox|ea|electronic arts|activision|epic games|bloomberg|goldman sachs|morgan stanley|jpmorgan|jp morgan|j\.?p\.? morgan|capital one|american express|visa|mastercard|paypal|boeing|lockheed|raytheon|rtx|northrop|general dynamics|caterpillar|deere|3m|ge |general electric|honeywell|siemens|abbvie|abbott|pfizer|merck|johnson)/i;

/**
 * Role words each resume is FOR, which is a different thing from the
 * technologies it mentions.
 *
 * The first version matched each archetype's technology vocabulary -- Python,
 * Kafka, Docker -- against job TITLES, and titles do not contain those. swe
 * scored zero on a pipeline that is mostly software-engineering roles. A title
 * is role language, so the match has to be against role language.
 *
 * Kept as an explicit table rather than inferred: which titles a resume is for
 * is a targeting decision, not something derivable from the bullets.
 */
export const ROLE_WORDS = {
  swe: ['software engineer', 'software developer', 'software engineering', 'backend', 'back end',
    'frontend', 'front end', 'full stack', 'fullstack', 'application developer', 'systems engineer',
    'platform engineer', 'developer', 'programmer', 'android', 'ios', 'mobile'],
  ai_engineer: ['ai engineer', 'machine learning', 'ml engineer', 'applied ai', 'applied ml',
    'applied scientist', 'generative ai', 'genai', 'nlp', 'ai/ml', 'deep learning', 'llm',
    'research engineer', 'ai research', 'artificial intelligence'],
  data_engineer: ['data engineer', 'data engineering', 'analytics engineer', 'etl', 'data platform',
    'data pipeline', 'data infrastructure', 'big data', 'data warehouse'],
  solutions_architect: ['solutions architect', 'solution architect', 'cloud architect', 'devops',
    'site reliability', 'sre', 'infrastructure engineer', 'platform', 'cloud engineer',
    'technical account', 'presales', 'pre-sales'],
  pm_tech_lead: ['product manager', 'product management', 'program manager', 'technical program',
    'technical product', 'associate product', 'apm', 'product intern', 'product analyst'],
  tech_consultant: ['consultant', 'consulting', 'technology analyst', 'business technology',
    'implementation', 'rotational', 'technical analyst', 'advisory'],
  research_ga: ['research', 'research assistant', 'research intern', 'scientist', 'quantitative',
    'quant', 'data scientist', 'data science'],
  housing_ga: ['student services', 'residence', 'housing', 'student support', 'community director'],
};

/** Every resume you have, with the role words it is aimed at. */
export function archetypeVocabularies(library, resumes, root) {
  const out = [];
  for (const r of resumes) {
    if (r.tailored_from) continue; // tailored copies duplicate their parent
    const words = ROLE_WORDS[r.id];
    if (!words) continue; // a resume with no declared targeting is not a match candidate
    out.push({ id: r.id, vocabulary: words });
  }
  return out;
}

/** Best-fitting resume for one posting title, and how clear the win is. */
export function bestFit(title, archetypes) {
  const scored = archetypes
    .map((a) => ({ id: a.id, hits: a.vocabulary.filter((t) => covers(title, t)) }))
    .map((a) => ({ ...a, n: a.hits.length }))
    .sort((a, b) => b.n - a.n);
  const top = scored[0];
  if (!top || top.n === 0) return null;
  return { resume: top.id, hits: top.hits, score: top.n, margin: top.n - (scored[1]?.n ?? 0) };
}

function main() {
  if (flag('--help') || flag('-h')) {
    console.log(`Rank the pipeline against every resume you have. Zero tokens.

  node target-list.mjs                      # top 60, your locations
  node target-list.mjs --near chicago       # one metro
  node target-list.mjs --top 100
  node target-list.mjs --tier1              # only the names that carry weight
  node target-list.mjs --check-eligibility   # read each JD and drop confirmed mismatches
  node target-list.mjs --out data/targets.md`);
    return;
  }

  const library = validateLibrary(yaml.load(fs.readFileSync(path.join(ROOT, 'config/bullets.yml'), 'utf8'))).bullets;
  const resumes = yaml.load(fs.readFileSync(path.join(ROOT, 'config/resumes.yml'), 'utf8'))?.resumes ?? [];
  const archetypes = archetypeVocabularies(library, resumes, ROOT);
  if (!archetypes.length) { console.error('No resumes in config/resumes.yml.'); process.exit(1); }

  const near = String(arg('--near', 'chicago,illinois,tucson,phoenix,arizona,remote'))
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const top = Number(arg('--top', '60')) || 60;
  const tier1Only = flag('--tier1');
  // Checking eligibility means fetching each JD, so it is opt-in and bounded.
  // Without it the list is a shortlist; with it, it is a list you can work.
  const checkEligible = flag('--check-eligibility');
  const profile = (() => {
    try { return yaml.load(fs.readFileSync(path.join(ROOT, 'config/profile.yml'), 'utf8')) ?? {}; }
    catch { return {}; }
  })();

  const rows = fs.readFileSync(path.join(ROOT, 'data/pipeline.md'), 'utf8')
    .split('\n').map((l, i) => parseRow(l, i)).filter(Boolean).filter((r) => !r.done);

  const seen = new Set();
  const scored = [];
  for (const r of rows) {
    if (!isEarlyCareer(r.title)) continue;
    const loc = r.location.toLowerCase();
    // Word boundaries, not substrings. `--near ", IL "` is trimmed to "il",
    // which as a substring matches Philadelphia, Wilmington and Huntsville --
    // a Chicago-only list came back with three states in it. `covers()` is the
    // same boundary check the tailor uses on keywords.
    const localish = near.some((n) => covers(loc, n));
    if (!localish) continue;
    if (/\b(uk|united kingdom|canada|india|emea|apac|colombia|mexico|brazil|singapore|japan|australia|germany|poland)\b/i.test(loc)
        && !/\b(chicago|illinois|tucson|phoenix|arizona|united states|usa)\b/i.test(loc)) continue;

    // A title naming a degree level rules a posting out without any JD at all:
    // "Data Scientist Research Intern - PhD" is not ambiguous.
    const levels = (profile.degrees ?? []).map((d) => String(d.level ?? '').toLowerCase());
    if (/\b(phd|ph\.d|doctoral)\b/i.test(r.title) && !levels.includes('phd')) continue;
    if (/\bmba\b/i.test(r.title) && !levels.includes('mba')) continue;

    const fit = bestFit(r.title, archetypes);
    if (!fit) continue;
    const tier1 = TIER1.test(r.company.trim());
    if (tier1Only && !tier1) continue;

    const key = `${r.company.toLowerCase().replace(/[^a-z]/g, '')}::${r.title.toLowerCase().replace(/[^a-z]/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const age = r.postedAt ? (Date.now() - Date.parse(r.postedAt)) / 86400_000 : 60;
    scored.push({
      ...r, ...fit, tier1,
      // Tier-1 is worth a lot, fit is worth more than freshness, and a posting
      // nobody has touched in three months is worth less than a fresh one.
      rank: (tier1 ? 25 : 0) + fit.score * 6 + Math.max(0, 30 - age) / 3,
    });
  }
  scored.sort((a, b) => b.rank - a.rank);
  let list = scored.slice(0, top);

  if (checkEligible) {
    if (!profile.degrees?.length) {
      console.error('--check-eligibility needs a `degrees:` block in config/profile.yml.');
      process.exit(1);
    }
    const code = path.dirname(new URL(import.meta.url).pathname);
    let checked = 0, dropped = 0;
    for (const r of list) {
      let jd = '';
      try {
        jd = execFileSync(process.execPath, [path.join(code, 'fetch-jd.mjs'), r.url],
          { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch { /* no API for this ATS; stays unknown and passes */ }
      if (!jd) { r.eligible = 'no-jd'; continue; }
      checked++;
      const e = eligibility(jd, profile);
      r.eligible = e.verdict;
      r.eligibleWhy = e.reason;
      if (e.verdict === 'ineligible') dropped++;
    }
    console.error(`eligibility: ${checked} JDs read, ${dropped} ruled out, ${list.length - checked} had no readable JD`);
    // A confirmed mismatch is removed; unknown and no-jd stay, because silence
    // about a requirement is not evidence of failing it.
    list = list.filter((r) => r.eligible !== 'ineligible');
  }

  const lines = [
    `# Target list — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `${rows.length} open rows → ${scored.length} early-career roles in your locations that match at least one of your`,
    `${archetypes.length} resumes → top ${list.length} below.`,
    '',
    '`resume` is the archetype whose own vocabulary best fits the title — that is what to send.',
    '`fit` is how many of its terms the title hits; `±` is the margin over the runner-up, so a',
    'small margin means two resumes are about equally good and positioning is your call.',
    '',
    ...(checkEligible ? ['`elig` — ✓ the posting\'s stated graduation window fits one of your degrees; `?` it names none.',
      'Rows whose window CONFIRMS a mismatch are removed, not shown.', ''] : []),
    `| # | Company | Role | Where | Resume | fit | ± |${checkEligible ? ' elig |' : ''} Link |`,
    `|---|---|---|---|---|---|---|${checkEligible ? '---|' : ''}---|`,
  ];
  list.forEach((r, i) => {
    lines.push(`| ${i + 1}${r.tier1 ? ' ★' : ''} | ${r.company} | ${r.title.replace(/\|/g, '/')} `
      + `| ${r.location.slice(0, 30).replace(/\|/g, '/')} | ${r.resume} | ${r.score} | ${r.margin} `
      + `|${checkEligible ? ` ${r.eligible === 'eligible' ? '✓' : '?'} |` : ''} ${r.url} |`);
  });
  lines.push('', '★ = a name that carries weight on its own.', '',
    'Compose the named resume for any row with:',
    '  node compose-resume.mjs --resume <resume>',
    'or tailor it to that posting with:',
    '  node tailor.mjs --jd <file> --resume <resume>');

  const outFile = arg('--out');
  const text = lines.join('\n') + '\n';
  if (outFile) {
    fs.writeFileSync(path.resolve(ROOT, outFile), text);
    console.log(`Wrote ${list.length} targets to ${outFile}`);
  } else {
    process.stdout.write(text);
  }

  const byResume = {};
  for (const r of list) byResume[r.resume] = (byResume[r.resume] || 0) + 1;
  console.error('\nby resume: ' + Object.entries(byResume).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`).join(' · '));
  console.error(`tier-1 names in the list: ${list.filter((r) => r.tier1).length}`);
}

if (isMainModule(import.meta.url)) main();
