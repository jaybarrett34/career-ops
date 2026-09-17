#!/usr/bin/env node
// Render a .tex archetype from the bullet library and compile it to one page.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import zlib from 'node:zlib';
import { validateLibrary, selectBullets, scoreAgainstKeywords } from './lib/bullets.mjs';
import { headings, headingAt } from './lib/tex-sections.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = getCareerOpsRoot();

/**
 * What a built PDF was made of: the rendered text of every bullet, in order,
 * plus the template. Anything that would change the page changes this; nothing
 * else does.
 */
export function buildFingerprint(picked, template) {
  const body = picked.map((b) => `${b.id}\u0000${b.rendered ?? b.text}`).join('\u0001');
  return createHash('sha256').update(`${template}\u0002${body}`).digest('hex').slice(0, 32);
}
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);

function usage() {
  console.log(`Usage:
  node compose-resume.mjs --resume swe                 # compose a saved resume
  node compose-resume.mjs --resume swe --out /tmp      # choose an output directory
  node compose-resume.mjs --list                       # list saved resumes
  node compose-resume.mjs --resume swe --keywords "kafka,python"   # rank bullets against a listing
  node compose-resume.mjs --resume swe --dry-run       # render the .tex, do not compile`);
}

function loadLibrary() {
  const p = path.join(ROOT, 'config/bullets.yml');
  if (!fs.existsSync(p)) { console.error('config/bullets.yml not found. Run scripts/seed-bullets.mjs first.'); process.exit(1); }
  const { bullets, errors } = validateLibrary(yaml.load(fs.readFileSync(p, 'utf8')));
  for (const e of errors) console.error(`  bullets.yml: ${e}`);
  return bullets;
}

function loadResumes() {
  const p = path.join(ROOT, 'config/resumes.yml');
  if (!fs.existsSync(p)) return [];
  const d = yaml.load(fs.readFileSync(p, 'utf8'));
  return Array.isArray(d?.resumes) ? d.resumes : [];
}

const escTex = (s) => s;

// Replace each employer's bullet list in the template with the selected ids.
export function renderTex(template, byOrg, preferShort = false) {
  const H = headings(template);
  return template.replace(/(\\resumeItemListStart\n)([\s\S]*?)(\n[ \t]*\\resumeItemListEnd)/g,
    (whole, head, _body, tail, offset) => {
      const picks = byOrg.get(headingAt(H, offset));
      if (!picks || !picks.length) return whole;
      return head + picks.map((b) => `      \\resumeItem{${preferShort && b.short ? b.short : b.text}}`).join('\n') + tail;
    });
}

export function pageCount(pdfPath) {
  const d = fs.readFileSync(pdfPath);
  let best = null;
  const re = /stream\r?\n/g; let m;
  const s = d.toString('latin1');
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let raw;
    try { raw = zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1'); } catch { continue; }
    for (const c of raw.matchAll(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/g)) {
      const v = Number(c[1]); best = best === null ? v : Math.max(best, v);
    }
  }
  return best;
}

function main() {
  if (flag('--help')) return usage();
  const library = loadLibrary();
  const resumes = loadResumes();

  if (flag('--list')) {
    if (!resumes.length) return console.log('No saved resumes. Add them to config/resumes.yml.');
    for (const r of resumes) console.log(`  ${r.id.padEnd(22)} ${r.bullets?.length ?? 0} bullets  template=${r.template}`);
    return;
  }

  const want = arg('--resume');
  const r = resumes.find((x) => x.id === want);
  if (!r) { console.error(`Unknown resume "${want}". Try --list.`); process.exit(1); }

  const kw = (arg('--keywords') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (kw.length) {
    const ranked = library.map((b) => ({ id: b.id, org: b.org, n: scoreAgainstKeywords(b, kw) }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 12);
    console.log('Bullets matching the listing:');
    for (const x of ranked) console.log(`  ${String(x.n).padStart(2)}  ${x.id}  (${x.org})`);
    console.log('');
  }

  const { picked, missing } = selectBullets(library, r.bullets);
  for (const m of missing) console.error(`  unknown bullet id: ${m}`);

  const byOrg = new Map();
  for (const b of picked) {
    if (!byOrg.has(b.org)) byOrg.set(b.org, []);
    byOrg.get(b.org).push(b);
  }

  const templatePath = path.resolve(ROOT, r.template);
  if (!fs.existsSync(templatePath)) { console.error(`template not found: ${templatePath}`); process.exit(1); }
  const template = fs.readFileSync(templatePath, 'utf8');

  const outDir = arg('--out', path.join(ROOT, 'output'));
  fs.mkdirSync(outDir, { recursive: true });
  const texOut = path.join(outDir, `${r.id}.tex`);

  // Try full-length first; fall back to short variants only if the page overflows.
  for (const preferShort of [false, true]) {
    const rendered = renderTex(template, byOrg, preferShort);
    // A heading whose bullets did not match keeps the TEMPLATE's own content,
    // which is usually fine -- but a scaffold left behind while wiring a new
    // entry then ships silently into a PDF someone sends. That happened: an
    // \href in a heading changed the key the scanner derives, no bullet matched,
    // and the placeholder rendered with no error anywhere.
    const scaffold = /PLACEHOLDER|\bTODO\b|\bFIXME\b|\bLOREM\b/i.exec(rendered);
    if (scaffold) {
      console.error(`${r.id}: refusing to build -- "${scaffold[0]}" is still in the rendered .tex.`);
      console.error('A heading\'s bullets did not match, so the template\'s own text was kept.');
      console.error('Check that each bullet\'s `org` equals the heading key (node compose-resume.mjs --list).');
      process.exit(2);
    }
    fs.writeFileSync(texOut, rendered);
    if (flag('--dry-run')) { console.log(`wrote ${texOut} (dry run)`); return; }
    try {
      execFileSync('tectonic', ['-X', 'compile', texOut, '--outdir', outDir], { stdio: 'ignore' });
    } catch {
      console.error('tectonic failed'); process.exit(1);
    }
    const pdf = path.join(outDir, `${r.id}.pdf`);
    const pages = pageCount(pdf);
    if (pages === 1) {
      // Record exactly what this PDF was built from. Staleness was previously
      // inferred from config/resumes.yml's mtime, which is far too coarse:
      // adding a field to ONE entry rewrote the file and marked all eleven PDFs
      // out of date. A fingerprint of this resume's own inputs is exact, so an
      // unrelated edit never invalidates it.
      fs.writeFileSync(path.join(outDir, `${r.id}.build.json`), JSON.stringify({
        builtAt: new Date().toISOString(),
        preferShort,
        fingerprint: buildFingerprint(picked, template),
      }, null, 2) + '\n');
      console.log(`${r.id}: ${picked.length} bullets, 1 page -> ${pdf}`);
      return;
    }
    console.log(`${r.id}: ${pages} pages with ${preferShort ? 'short' : 'full'} variants${preferShort ? '' : ', retrying short'}`);
  }
  console.error(`${r.id}: still over one page. Drop a bullet from config/resumes.yml.`);
  process.exit(2);
}

if (isMainModule(import.meta.url)) main();
