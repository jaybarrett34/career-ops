#!/usr/bin/env node
// Seed config/bullets.yml from the hand-maintained .tex archetypes.
import fs from 'node:fs';
import path from 'node:path';
import { groupVariants, slugId } from '../lib/bullets.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const TEX_DIR = process.argv[2] || path.join(getCareerOpsRoot(), '../resume-list/fable-reviewed-archetypes/tex');
const OUT = path.join(getCareerOpsRoot(), 'config/bullets.yml');

const items = [];
for (const f of fs.readdirSync(TEX_DIR).filter((x) => x.endsWith('.tex'))) {
  const s = fs.readFileSync(path.join(TEX_DIR, f), 'utf8');
  const arch = f.replace('.tex', '');
  const re = /\\resumeSubheading\s*\n?\s*\{([^}]*)\}\{([^}]*)\}\s*\n?\s*\{([^}]*)\}\{([^}]*)\}(.*?)\\resumeItemListEnd/gs;
  for (const m of s.matchAll(re)) {
    const org = (m[3] || m[1] || '').trim();
    for (const b of m[5].matchAll(/\\resumeItem\{(.*?)\}\s*\n/gs)) {
      items.push({ org, arch, text: b[1].split(/\s+/).join(' ').trim() });
    }
  }
}

const groups = groupVariants(items, 0.48);
const taken = new Set();
const yaml = ['# Bullet library. Generated from the .tex archetypes, then hand-edited.',
  '# A resume is a list of these ids; see config/resumes.yml.', 'bullets:'];
for (const g of groups) {
  const c = g.canonical;
  const id = slugId(c.org, c.text, taken);
  const archs = [...new Set([c, ...g.variants].map((v) => v.arch))].sort();
  const esc = (t) => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  yaml.push(`  - id: ${id}`);
  yaml.push(`    org: ${esc(c.org)}`);
  yaml.push(`    text: ${esc(c.text)}`);
  const shortest = g.variants.length ? g.variants[g.variants.length - 1] : null;
  if (shortest && shortest.text.length < c.text.length * 0.9) yaml.push(`    short: ${esc(shortest.text)}`);
  yaml.push(`    archetypes: [${archs.join(', ')}]`);
  if (g.variants.length) yaml.push(`    # ${g.variants.length} near-duplicate phrasing(s) collapsed`);
}
fs.writeFileSync(OUT, yaml.join('\n') + '\n');
console.log(`${items.length} bullets in ${new Set(items.map(i=>i.arch)).size} archetypes -> ${groups.length} library entries`);
console.log(`wrote ${OUT}`);
