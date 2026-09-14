import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headings, headingAt } from '../lib/tex-sections.mjs';

const SRC = `\\section{Experience}
  \\resumeSubheading
    {Software Engineer, Infrastructure Tools}{June 2026 -- Present}
    {Intel Corporation}{Chandler, AZ}
    \\resumeItemListStart
      \\resumeItem{A}
    \\resumeItemListEnd
\\section{Projects}
  \\resumeProjectHeading
  {\\textbf{MovieMatch} $|$ \\emph{Next.js 16, React 19}}{February 2026}
    \\resumeItemListStart
      \\resumeItem{B}
    \\resumeItemListEnd
`;

test('employer comes from the third argument, not the title', () => {
  const h = headings(SRC);
  assert.ok(h.some((x) => x.key === 'Intel Corporation'));
  assert.ok(!h.some((x) => x.key.startsWith('Software Engineer')));
});

test('a project heading with nested braces is read', () => {
  // {\textbf{MovieMatch} $|$ \emph{...}} defeats any [^}]* pattern.
  assert.ok(headings(SRC).some((x) => x.key === 'PROJECT: MovieMatch'));
});

test('sections are captured and distinguished from employers', () => {
  const keys = headings(SRC).map((x) => x.key);
  assert.ok(keys.includes('SECTION: Experience'));
  assert.ok(keys.includes('SECTION: Projects'));
});

test('headings come back in document order', () => {
  const h = headings(SRC);
  for (let i = 1; i < h.length; i++) assert.ok(h[i].i > h[i - 1].i);
});

test('a bullet resolves to its nearest preceding heading', () => {
  const h = headings(SRC);
  assert.equal(headingAt(h, SRC.indexOf('\\resumeItem{A}')), 'Intel Corporation');
  assert.equal(headingAt(h, SRC.indexOf('\\resumeItem{B}')), 'PROJECT: MovieMatch');
});

test('an offset before any heading resolves to empty, not a crash', () => {
  assert.equal(headingAt(headings(SRC), 0), '');
  assert.equal(headingAt([], 500), '');
});

test('an unterminated argument does not hang or throw', () => {
  assert.doesNotThrow(() => headings('\\resumeSubheading {unclosed'));
  assert.doesNotThrow(() => headings('\\section{'));
});

test('escaped braces inside an argument do not end it early', () => {
  const s = '\\section{Skills \\& Tools}';
  assert.equal(headings(s)[0].key, 'SECTION: Skills & Tools');
});
