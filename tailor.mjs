#!/usr/bin/env node
/**
 * tailor.mjs — rearrange which bullets a resume uses for one specific listing.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It SELECTS among bullets already in config/bullets.yml — sentences the user
 * wrote and has verified. It never writes a bullet, never rephrases one toward
 * a keyword, and never proposes a claim the library cannot already support.
 * That is the line AGENTS.md draws: "Keywords get reformulated, never
 * fabricated." Reordering and reselecting is reformulation. Anything that would
 * put a new claim on the page is the user's call, through `add`/`expand`, with
 * their confirmation.
 *
 * So a keyword nothing in the library covers comes back as a GAP, printed and
 * left alone. The tool stops there on purpose.
 *
 * Zero tokens: keyword extraction is jd-skill-gap.mjs's existing vocabulary
 * scanner, and selection is set cover. No model is called.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateLibrary } from './lib/bullets.mjs';
import { tailorResume, resumeVocabulary, keywordsFromJd, setCoverage, bulletCoverage } from './lib/tailor.mjs';

const ROOT = getCareerOpsRoot();
const CODE = path.dirname(new URL(import.meta.url).pathname);

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(n);

function usage() {
  console.log(`Re-pick a resume's bullets for one listing. Zero tokens, no model.

  node tailor.mjs --report 1                      # what would change, and why
  node tailor.mjs --report 1 --resume swe         # against a specific archetype
  node tailor.mjs --jd path/to/jd.txt --resume swe
  node tailor.mjs --report 1 --apply              # save as its own resume and compile

--apply writes a NEW entry in config/resumes.yml named for the listing and
leaves the archetype untouched, so the tailored version is reproducible and the
original still composes as it did.`);
}

/** The JD text: the report's archived section, or a file, or the live posting. */
function jdText() {
  const file = arg('--jd');
  if (file) return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

  const n = arg('--report');
  if (!n) { console.error('Give --report N or --jd <file>.'); process.exit(1); }
  const pad = String(n).padStart(3, '0');
  const dir = path.join(ROOT, 'reports');
  const hit = fs.existsSync(dir)
    ? fs.readdirSync(dir).find((f) => f.startsWith(`${pad}-`) || f.startsWith(`${n}-`))
    : null;
  if (!hit) { console.error(`No report ${n} in ${dir}.`); process.exit(1); }

  const md = fs.readFileSync(path.join(dir, hit), 'utf8');
  // Reports carry the JD verbatim precisely so this kind of work does not have
  // to refetch a posting that may already be closed (#2789).
  const m = /##\s*Job Description[^\n]*\n([\s\S]*)$/i.exec(md);
  if (m && m[1].trim().length > 200) return m[1];

  const url = /^\*\*URL:\*\*\s*(\S+)/m.exec(md)?.[1];
  if (!url) { console.error(`Report ${n} has no archived JD and no URL to fall back to.`); process.exit(1); }
  console.error(`Report ${n} has no archived JD section; fetching ${url}`);
  try {
    return execFileSync(process.execPath, [path.join(CODE, 'fetch-jd.mjs'), url], { encoding: 'utf8', timeout: 60000 });
  } catch {
    console.error('Could not fetch the posting either. Pass --jd <file>.');
    process.exit(1);
  }
}

const readYaml = (p, fallback) => {
  try { return yaml.load(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

function main() {
  if (flag('--help') || flag('-h') || process.argv.length <= 2) return usage();

  const libFile = path.join(ROOT, 'config/bullets.yml');
  const resFile = path.join(ROOT, 'config/resumes.yml');
  const library = validateLibrary(readYaml(libFile, {})?.bullets ?? []).bullets;
  const resumes = readYaml(resFile, {})?.resumes ?? [];
  if (!library.length) { console.error(`No bullets in ${libFile}.`); process.exit(1); }

  const want = arg('--resume', 'swe');
  const base = resumes.find((r) => r.id === want);
  if (!base) {
    console.error(`Unknown resume "${want}". Known: ${resumes.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }

  const text = jdText();

  // The skills line sits in the template and is on the page whatever bullets are
  // chosen, so its terms count as covered and belong in the vocabulary.
  let skillsText = '';
  try {
    const tex = fs.readFileSync(path.resolve(ROOT, base.template), 'utf8');
    skillsText = /section\{Technical Skills\}([\s\S]*?)\\end\{document\}/.exec(tex)?.[1] ?? '';
  } catch { /* a template without a skills section is fine */ }

  const extra = (arg('--keywords') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const vocabulary = [...new Set([...resumeVocabulary(library, skillsText), ...extra])];
  const keywords = [...new Set([...keywordsFromJd(vocabulary, text), ...extra.filter((k) => k)])];
  if (!keywords.length) {
    console.error('This posting asks for nothing your material already contains.');
    console.error('That is a finding, not an error — it is the wrong role, or the');
    console.error('vocabulary needs a term. Pass --keywords "a,b,c" to drive it by hand.');
    process.exit(1);
  }

  const r = tailorResume(library, base.bullets, keywords);
  const pct = (n) => `${Math.round((n / keywords.length) * 100)}%`;

  console.log(`${vocabulary.length} terms your material can speak to; this posting asks for ${keywords.length}:`);
  console.log(`  ${keywords.join(', ')}\n`);
  console.log(`Unique coverage   ${r.coveredBefore.length}/${keywords.length} (${pct(r.coveredBefore.length)})`
    + `  ->  ${r.coveredAfter.length}/${keywords.length} (${pct(r.coveredAfter.length)})`);
  console.log(`Total mentions    ${r.mentionsBefore}  ->  ${r.mentionsAfter}`
    + '   (how often the page says them; what keyword-weighted ATS scoring sees)');
  // The human half. Both numbers above are ATS metrics and a page can improve on
  // them while getting worse to read -- the reader decides whether you have done
  // the job, and they decide on outcomes, not term frequency.
  console.log(`Bullets w/ outcome ${r.outcomeBefore.withOutcome}/${r.outcomeBefore.total}`
    + `  ->  ${r.outcomeAfter.withOutcome}/${r.outcomeAfter.total}`
    + '   (says what the work produced, not just what it was)\n');
  if (r.outcomeLost.length) {
    console.log(`  WARNING: ${r.outcomeLost.length} bullet(s) with an outcome were swapped out for keyword coverage:`);
    for (const id of r.outcomeLost) console.log(`    ${id}`);
    console.log('  Keywords got you read; outcomes get you interviewed. Reconsider these.\n');
  }

  for (const o of r.perOrg) {
    const swapped = o.after.filter((id) => !o.before.includes(id));
    const dropped = o.before.filter((id) => !o.after.includes(id));
    if (!swapped.length && !dropped.length) {
      console.log(`  ${o.org}: unchanged (${o.coveredAfter.length} keywords)`);
      continue;
    }
    console.log(`  ${o.org}: ${o.coveredBefore.length} -> ${o.coveredAfter.length} keywords`);
    for (const id of dropped) console.log(`    out  ${id}`);
    for (const id of swapped) console.log(`    in   ${id}`);
  }

  const gained = r.coveredAfter.filter((k) => !r.coveredBefore.includes(k));
  const lost = r.coveredBefore.filter((k) => !r.coveredAfter.includes(k));
  if (gained.length) console.log(`\n  gained: ${gained.join(', ')}`);
  if (lost.length) console.log(`  lost:   ${lost.join(', ')}`);

  if (r.stillMissing.length) {
    console.log(`\n  ${r.stillMissing.length} keyword(s) the library covers but the page has no room for:`);
    console.log(`    ${r.stillMissing.join(', ')}`);
  }
  // Terms in the skills line are on the page regardless of bullet choice, so
  // they are never a swap; naming them keeps the coverage number honest.
  const viaSkills = r.unclaimable.filter((k) => skillsText && k && new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(skillsText));
  if (viaSkills.length) {
    console.log(`\n  covered by the skills line, not by any bullet: ${viaSkills.join(', ')}`);
  }
  const trulyMissing = r.unclaimable.filter((k) => !viaSkills.includes(k));
  if (trulyMissing.length) {
    console.log(`\n  ${trulyMissing.length} term(s) nothing in your material covers: ${trulyMissing.join(', ')}`);
    console.log('  Not swaps. The resume cannot honestly claim these until the underlying');
    console.log('  fact exists — add it through `add` or `expand`, with your confirmation.');
    console.log('  Nothing here will write a bullet for you.');
  }

  if (!flag('--apply')) {
    console.log(r.changed ? '\n(preview: --apply to save this as its own resume and compile)' : '\nNothing to swap.');
    return;
  }
  if (!r.changed) return console.log('\nNothing to swap; not writing a resume entry.');

  const slug = (arg('--name') || `${want}-${arg('--report') ? `r${arg('--report')}` : 'listing'}`)
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  // A NEW entry, never an edit of the archetype: the archetype is the general
  // resume and must keep composing as it did, while the tailored one stays
  // reproducible instead of being a file someone regenerated by hand.
  console.log('');

  const out = arg('--out') || path.join(ROOT, 'output', slug);

  // A tailored page can overflow: the bullets that cover more keywords are
  // usually the longer ones, and compose already exhausts its short variants
  // before giving up. Rather than hand back a file that will not compile, back
  // out the least valuable swap and try again -- least valuable meaning the one
  // whose bullet adds fewest keywords the rest of the page does not already
  // carry. The original archetype bullet goes back into that slot, so every
  // retry is still a resume the user had.
  const byId = new Map(library.map((x) => [x.id, x]));
  let ids = [...r.ids];
  const swaps = r.perOrg.flatMap((o) => o.after
    .filter((id) => !o.before.includes(id))
    .map((id) => ({ id, org: o.org, restore: o.before.find((b) => !o.after.includes(b)) })));

  for (let attempt = 0; ; attempt++) {
    writeResume(resFile, slug, base.template, ids, want);
    try {
      const log = execFileSync(process.execPath,
        [path.join(CODE, 'compose-resume.mjs'), '--resume', slug, '--out', out], { encoding: 'utf8' });
      const line = log.split('\n').find((l) => l.includes('->'));
      if (line) console.log(line.trim());
      break;
    } catch {
      const remaining = swaps.filter((sw) => ids.includes(sw.id) && sw.restore);
      if (!remaining.length) {
        console.error('\nStill over one page with every swap backed out. The archetype itself');
        console.error('is at its limit — drop a bullet from config/resumes.yml.');
        return;
      }
      // Rank by what each swapped-in bullet uniquely contributes to the page.
      const worst = remaining
        .map((sw) => {
          const others = ids.filter((id) => id !== sw.id).map((id) => byId.get(id)).filter(Boolean);
          const withoutIt = setCoverage(others, keywords);
          const unique = bulletCoverage(byId.get(sw.id), keywords).filter((k) => !withoutIt.has(k)).length;
          return { ...sw, unique };
        })
        .sort((a, b) => a.unique - b.unique)[0];
      ids = ids.map((id) => (id === worst.id ? worst.restore : id));
      console.log(`  over one page — backing out ${worst.id} (adds ${worst.unique} unique), restoring ${worst.restore}`);
    }
  }

  const final = ids.filter((id) => !base.bullets.includes(id));
  if (final.length !== r.ids.filter((id) => !base.bullets.includes(id)).length) {
    console.log(`  kept ${final.length} of ${r.ids.filter((id) => !base.bullets.includes(id)).length} swaps to fit the page`);
  }
  console.log(`Resume "${slug}" saved in config/resumes.yml; recompose any time with`);
  console.log(`  node compose-resume.mjs --resume ${slug}`);

  try {
    const check = execFileSync(process.execPath, [path.join(CODE, 'verify-cv-facts.mjs'), path.join(out, `${slug}.tex`)],
      { encoding: 'utf8' });
    const flags = check.split('\n').filter((l) => /advisory|forbidden/.test(l));
    console.log(flags.length ? flags.join('\n') : 'verify-cv-facts: clean');
  } catch (e) {
    console.error(`verify-cv-facts: ${e.message}`);
  }
}

/** Replace (or add) one named resume entry, leaving every other entry alone. */
function writeResume(resFile, id, template, bullets, tailoredFrom = null) {
  const doc = readYaml(resFile, { resumes: [] });
  doc.resumes = (doc.resumes ?? []).filter((x) => x.id !== id);
  // Recording the archetype it came from is what lets a reader -- and the
  // Resumes page -- tell a hand-maintained foundational resume from one this
  // tool generated for a single posting. Without it every entry looks equally
  // authoritative and nobody knows which are safe to delete.
  doc.resumes.push({ id, template, ...(tailoredFrom ? { tailored_from: tailoredFrom } : {}), bullets });
  fs.writeFileSync(resFile, yaml.dump(doc, { lineWidth: 120, noRefs: true }));
}

if (isMainModule(import.meta.url)) main();
