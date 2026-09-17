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

test('a linked heading keys on its label, not its URL', () => {
  // \href{url}{label} in a heading put the URL into the key -- "PROJECT:
  // https://github.com/.../pull/4064career-ops" -- so no bullet matched and the
  // template's placeholder rendered into the PDF with no error raised.
  const tex = [
    '\\section{Projects}',
    '  \\resumeProjectHeading',
    '  {\\href{https://github.com/o/r/pull/4064}{\\underline{\\textbf{career-ops}}} $|$ \\emph{Node.js}}{September 2026}',
    '  \\resumeItemListStart',
    '  \\resumeItem{x}',
    '  \\resumeItemListEnd',
  ].join('\n');
  const keys = headings(tex).map((h) => h.key);
  assert.ok(keys.includes('PROJECT: career-ops'), keys.join(' | '));
  assert.ok(!keys.some((k) => k.includes('http')), 'no key may carry a URL');
});

test('an unlinked heading is unchanged by the href handling', () => {
  const tex = '\\resumeProjectHeading\n  {\\textbf{MovieMatch} $|$ \\emph{Next.js}}{February 2026}';
  assert.deepEqual(headings(tex).map((h) => h.key), ['PROJECT: MovieMatch']);
});

test('unbalanced markup yields no heading rather than a wrong one', () => {
  // The reader cannot find a balanced pair, so it emits nothing. That is the
  // safe direction: a missing heading means no bullet matches and compose-resume
  // refuses to build, where a GUESSED heading would silently misfile bullets
  // under the wrong employer.
  const tex = '\\resumeProjectHeading\n  {\\href{ \\textbf{Thing}}{2026}';
  assert.doesNotThrow(() => headings(tex));
  assert.deepEqual(headings(tex), []);
});
