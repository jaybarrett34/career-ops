#!/usr/bin/env node
// Seed config/bullets.yml from the hand-maintained .tex archetypes.
import fs from 'node:fs';
import path from 'node:path';
import { groupVariants, slugId } from '../lib/bullets.mjs';
import { headings, headingAt } from '../lib/tex-sections.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const TEX_DIR = process.argv[2] || path.join(getCareerOpsRoot(), '../resume-list/fable-reviewed-archetypes/tex');
const OUT = path.join(getCareerOpsRoot(), 'config/bullets.yml');

const items = [];
for (const f of fs.readdirSync(TEX_DIR).filter((x) => x.endsWith('.tex'))) {
  const src = fs.readFileSync(path.join(TEX_DIR, f), 'utf8');
  const arch = f.replace('.tex', '');
  const H = headings(src);
  for (const b of src.matchAll(/\\resumeItem\{(.*?)\}\s*\n/gs)) {
    items.push({ org: headingAt(H, b.index), arch, text: b[1].split(/\s+/).join(' ').trim() });
  }
}

const groups = groupVariants(items, 0.48);
const taken = new Set();
const yaml = ['# Bullet library. Generated from the .tex archetypes, then hand-edited.',
  '# Every phrasing is its own entry so composing is lossless; entries sharing a fact',
  '# carry variant_of pointing at the first one. Consolidating is your choice, not automatic.',
  'bullets:'];
const esc = (t) => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const idMap = new Map();
for (const g of groups) {
  const all = [g.canonical, ...g.variants];
  let rootId = null;
  for (const v of all) {
    const id = slugId(v.org, v.text, taken);
    if (rootId === null) rootId = id;
    idMap.set(v.text + '\u0000' + v.org, id);
    yaml.push(`  - id: ${id}`);
    yaml.push(`    org: ${esc(v.org)}`);
    yaml.push(`    text: ${esc(v.text)}`);
    if (id !== rootId) yaml.push(`    variant_of: ${rootId}`);
  }
}
fs.writeFileSync(OUT, yaml.join('\n') + '\n');
console.log(`${items.length} bullets in ${new Set(items.map(i=>i.arch)).size} archetypes -> ${groups.length} library entries`);
console.log(`wrote ${OUT}`);

// Also seed config/resumes.yml: one saved resume per archetype, holding the
// bullet ids that archetype currently uses.
{
  const out = ['# Saved resumes. Each is a template plus an ordered list of bullet ids.', 'resumes:'];
  for (const f of fs.readdirSync(TEX_DIR).filter((x) => x.endsWith('.tex'))) {
    const arch = f.replace('.tex', '');
    const s = fs.readFileSync(path.join(TEX_DIR, f), 'utf8');
    const ids = [];
    for (const m of s.matchAll(/\\resumeItem\{(.*?)\}\s*\n/gs)) {
      const t = m[1].split(/\s+/).join(' ').trim();
      const org = headingAt(headings(s), m.index);
      const hit = idMap.get(t + '\u0000' + org) || [...idMap.entries()].find(([k]) => k.startsWith(t + '\u0000'))?.[1];
      if (hit && !ids.includes(hit)) ids.push(hit);
    }
    out.push(`  - id: ${arch}`);
    out.push(`    template: "../resume-list/fable-reviewed-archetypes/tex/${f}"`);
    out.push(`    bullets: [${ids.join(', ')}]`);
  }
  fs.writeFileSync(path.join(getCareerOpsRoot(), 'config/resumes.yml'), out.join('\n') + '\n');
  console.log(`wrote config/resumes.yml (${fs.readdirSync(TEX_DIR).filter(x=>x.endsWith('.tex')).length} resumes)`);
}

