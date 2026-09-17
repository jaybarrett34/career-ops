// Which heading a given offset in a .tex file falls under.
// Arguments are read with a brace-balanced scanner: a project heading's first
// argument is itself full of \textbf{...} and \emph{...}, which no [^}]* can read.

function readArg(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '{') return null;
  let depth = 0, start = ++i;
  for (; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { if (depth === 0) return { text: src.slice(start, i), end: i + 1 }; depth--; }
  }
  return null;
}

function args(src, i, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = readArg(src, i);
    if (!a) return out;
    out.push(a.text); i = a.end;
  }
  return out;
}

// \href{url}{label} must yield the LABEL. Stripping commands blindly left the
// URL in the key -- a heading linked to a PR became
// "PROJECT: https://github.com/.../pull/4064career-ops", which matched no bullet
// and silently rendered the template placeholder instead. Any linked heading
// would have hit this.
const dropHrefUrls = (s) => {
  let out = '', i = 0;
  while (i < s.length) {
    const j = s.indexOf('\\href', i);
    if (j < 0) { out += s.slice(i); break; }
    out += s.slice(i, j);
    const url = readArg(s, j + 5);
    if (!url) { out += s.slice(j, j + 5); i = j + 5; continue; }
    const label = readArg(s, url.end);
    if (!label) { i = url.end; continue; }
    out += label.text;          // keep what a reader sees, discard the target
    i = label.end;
  }
  return out;
};

const clean = (s) => dropHrefUrls(s)
  .replace(/\\([&%$#_{}])/g, '$1')
  .replace(/\\[a-zA-Z]+\s*/g, '')
  .replace(/[${}]/g, '')
  .split('|')[0]
  .replace(/\s+/g, ' ')
  .trim();

export function headings(src) {
  const out = [];
  for (const m of src.matchAll(/\\resumeSubheading/g)) {
    const a = args(src, m.index + m[0].length, 4);
    if (a.length >= 3) out.push({ i: m.index, key: (a[2] || a[0] || '').trim() });
  }
  for (const m of src.matchAll(/\\resumeProjectHeading/g)) {
    const a = args(src, m.index + m[0].length, 2);
    if (a.length) out.push({ i: m.index, key: 'PROJECT: ' + clean(a[0]) });
  }
  for (const m of src.matchAll(/\\section/g)) {
    const a = args(src, m.index + m[0].length, 1);
    if (a.length) out.push({ i: m.index, key: 'SECTION: ' + clean(a[0]) });
  }
  return out.sort((a, b) => a.i - b.i);
}

export function headingAt(heads, idx) {
  let last = '';
  for (const h of heads) { if (h.i < idx) last = h.key; else break; }
  return last;
}
