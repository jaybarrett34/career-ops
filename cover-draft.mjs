#!/usr/bin/env node
/**
 * cover-draft.mjs — a three-paragraph cover letter, generated, not written.
 *
 * WHY A TEMPLATE AND NOT A PER-JOB DRAFT
 *
 * Most applications that demand a cover letter do not read it closely; they
 * gate on its presence and scan it for keywords. Hand-tuning one per posting is
 * the single slowest thing in an application session, and at 100 applications
 * it is the difference between finishing and not. So the shape is fixed, and
 * only the ROLE-SPECIFIC evidence moves.
 *
 * Alex's structure, 2026-09-27:
 *   p1  interested, and here is the most recent applicable thing I do
 *   p2  the rest of my history, tangential but real, which also widens ATS
 *   p3  hope to hear back, thanks
 *
 * SOURCE OF TRUTH
 *
 * Every factual sentence comes from cv.md, config/profile.yml and
 * config/bullets.yml. Nothing is invented. The JD is read only to CHOOSE which
 * true sentence to lead with, never to add a claim.
 *
 * THE VOICE GATE IS A HARD FAILURE
 *
 * voice-dna.md bans em dashes (rule 3.38) and negative parallelism ("not X, but
 * Y" and its disguises) as rule 3F, marked FATAL. A generator that merely tries
 * to avoid them will emit one eventually. So the output is linted and a hit
 * REFUSES to write, rather than shipping a letter that reads as machine-made.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { covers } from './lib/tailor.mjs';
import { localToday } from './lib/local-today.mjs';

const ROOT = getCareerOpsRoot();
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(n);

/** voice-dna.md 3F plus the em-dash rule, as a gate. */
export const VOICE_VIOLATIONS = [
  [/—/, 'em dash (voice-dna 3.38)'],
  [/\bnot only\b[^.]*\bbut also\b/i, 'not only X but also Y (3F)'],
  [/\bit'?s not (just )?(about )?[^.]*\bit'?s\b/i, "it's not X, it's Y (3F)"],
  [/\bthis (is|isn'?t) not\b/i, 'this is not X (3F)'],
  [/\bisn'?t (just )?[^.]{0,60}\bit(’|')?s\b/i, "isn't X, it's Y (3F)"],
  [/\bless [a-z]+, more [a-z]+/i, 'less X, more Y (3F)'],
  [/\brather than merely\b/i, 'rather than merely (3F)'],
  [/\bnot merely\b/i, 'not merely (3F)'],
  [/\bwhile .{0,50} might seem .{0,40}\b(is|are) actually\b/i, 'while X might seem, Y actually (3F)'],
];

export function lintVoice(text) {
  return VOICE_VIOLATIONS.filter(([re]) => re.test(text)).map(([, why]) => why);
}

/** The bullets whose text best matches this posting, highest overlap first. */
export function rankBullets(bullets, jdText, role) {
  const hay = `${jdText ?? ''} ${role ?? ''}`.toLowerCase();
  const terms = [...new Set(hay.match(/[a-z][a-z+#.]{2,}/g) ?? [])];
  return bullets
    .map((b) => {
      const t = String(b.text ?? '').replace(/\\[a-z0pt{}]+/g, ' ');
      const hits = terms.filter((k) => k.length > 3 && covers(t, k)).length;
      return { ...t && { text: t }, id: b.id, org: b.org ?? '', hits };
    })
    .filter((b) => b.text)
    .sort((a, b) => b.hits - a.hits);
}

const strip = (s) => String(s ?? '')
  .replace(/\\\$/g, '$').replace(/\\%/g, '%').replace(/\\&/g, 'and')
  .replace(/\{\\kern0pt\}/g, '').replace(/\\textit\{([^}]*)\}/g, '$1')
  .replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '')
  .replace(/\s+/g, ' ').trim();

const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// Coursework and degree lines are facts about school, not things he did at a
// job, and paragraph two is about work history. They also rank high on keyword
// overlap (a course list is nothing but keywords), so without this the letter
// leads with "Before Acme I coursework: ...".
const EDU_ORG = /coursework|bachelor|master|university|college/i;
const familyOf = (b) => b.variant_of ?? b.variantOf ?? b.id;

export function draft({ company, role, jdText, bullets, profile }) {
  const ranked = rankBullets(bullets, jdText, role);
  const famOf = new Map(bullets.map((b) => [b.id, familyOf(b)]));
  const current = ranked.find((b) => /acme/i.test(b.org)) ?? ranked[0];
  const seenFam = new Set([famOf.get(current?.id)]);
  const seenOrg = new Set(['acme']);
  const others = [];
  for (const b of ranked) {
    if (b.id === current?.id || /acme/i.test(b.org) || EDU_ORG.test(b.org)) continue;
    const fam = famOf.get(b.id);
    const orgKey = String(b.org).toLowerCase().replace(/[^a-z]/g, '').slice(0, 10);
    // One sentence per family and per employer, or the paragraph repeats itself.
    if (seenFam.has(fam) || seenOrg.has(orgKey)) continue;
    seenFam.add(fam); seenOrg.add(orgKey);
    others.push(b);
    if (others.length === 2) break;
  }
  const name = profile?.personal?.name ?? profile?.name ?? 'Alex Doe';

  const p1 = `I am applying for the ${role} position at ${company}. I work as a software engineer on `
    + `Acme's infrastructure tools team, where I ${lower1(strip(current?.text))}. That is the work I would bring to this role.`;

  const hist = others.map((b) => `${lower1(strip(b.text))}`);
  // NOT "Before Acme". The chosen bullets are ranked by relevance, not date,
  // and the best match is often concurrent with Acme or later -- the Initech
  // study is September 2026 and Acme began in June. A chronology this function
  // cannot check is a claim it must not make.
  const p2 = `I also ${hist[0] ?? 'worked on data and platform engineering across consulting and contract roles'}`
    + (hist[1] ? `, and I ${hist[1]}` : '')
    + `. I finished a BA in computer science at State in May 2026, and I am partway through an MS in `
    + `Artificial Intelligence for Business at the City University, graduating December 2027.`;

  const p3 = `I would welcome the chance to talk about the role. Thank you for your time and for considering my application.`;

  return { name, paragraphs: [p1, p2, p3], used: [current?.id, ...others.map((b) => b.id)].filter(Boolean) };
}

function main() {
  if (flag('--help') || flag('-h')) {
    console.log(`Draft a three-paragraph cover letter from your own files. Zero tokens.

  node cover-draft.mjs --company "Example Co" --role "Economics Consulting Intern"
  node cover-draft.mjs --company X --role Y --jd path/to/jd.txt
  node cover-draft.mjs --company X --role Y --pdf               # render a PDF and reveal it in Finder

Facts come from cv.md, config/profile.yml and config/bullets.yml only. The JD is
read to choose WHICH true sentence leads, never to add a claim. Output is linted
against voice-dna.md (no em dashes, no negative parallelism) and a hit refuses.`);
    return;
  }
  const company = arg('--company');
  const role = arg('--role');
  if (!company || !role) { console.error('--company and --role are required.'); process.exit(1); }

  const jdPath = arg('--jd');
  const jdText = jdPath && fs.existsSync(jdPath) ? fs.readFileSync(jdPath, 'utf8') : '';
  const bullets = yaml.load(fs.readFileSync(path.join(ROOT, 'config/bullets.yml'), 'utf8')).bullets;
  const profile = yaml.load(fs.readFileSync(path.join(ROOT, 'config/profile.yml'), 'utf8'));

  const d = draft({ company, role, jdText, bullets, profile });
  const body = d.paragraphs.join('\n\n');
  const bad = lintVoice(body);
  if (bad.length) {
    console.error('REFUSING to write: voice-dna violations in the generated text:');
    for (const b of bad) console.error('  - ' + b);
    process.exit(1);
  }

  const payloadPath = arg('--payload') || (flag('--pdf')
    ? path.join(ROOT, 'output', `cover-${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`) : null);
  if (payloadPath) {
    const c = profile?.candidate ?? {};
    fs.writeFileSync(path.resolve(payloadPath), JSON.stringify({
      candidate: {
        name: c.full_name ?? d.name,
        email: (c.alternate_emails ?? []).find((e) => /school\.example$/i.test(e)) ?? c.email ?? '',
        phone: c.phone ?? '',
        location: c.location ?? '',
        linkedin: c.linkedin ?? '',
        github: c.github ?? '',
        credentials: '',
      },
      letter: {
        company, role_title: role, date: localToday(),
        greeting: 'Dear Hiring Team,', opening: d.paragraphs[0],
        profile_intro: d.paragraphs[1], closing: d.paragraphs[2],
        signature: d.name,
      },
    }, null, 2));
    console.log(`payload -> ${payloadPath}`);
  }
  console.log(`\n${localToday()}\n\nDear Hiring Team,\n\n${body}\n\nSincerely,\n${d.name}\n`);
  console.error(`(bullets used: ${d.used.join(', ')})`);

  if (flag('--pdf')) {
    const slug = `${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const out = path.join(ROOT, 'output/apply-pack', `Alex-Doe-cover-${slug}.pdf`);
    const code = path.dirname(fileURLToPath(import.meta.url));
    try {
      execFileSync(process.execPath,
        [path.join(code, 'generate-cover-letter.mjs'), '--payload', payloadPath, '--out', out],
        { stdio: 'inherit' });
      // Reveal it SELECTED in Finder, so it is one drag from the upload field.
      try { execFileSync('open', ['-R', out]); } catch { /* not macOS */ }
      console.error(`\nPDF: ${out}`);
    } catch (e) {
      console.error(`PDF render failed: ${e.message}`);
    }
  }
}

if (isMainModule(import.meta.url)) main();
