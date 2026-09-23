// Read an .xlsx back into rows. The other half of lib/xlsx.mjs.
//
// WHY A READER AT ALL
//
// Exporting is only half a loop. The useful workflow is: export the tracker,
// work it in Excel or Sheets on a plane, import it back. Without a reader the
// export is a dead end — a report you look at once.
//
// WHY IT CANNOT REUSE THE WRITER'S ASSUMPTIONS
//
// lib/xlsx.mjs writes STORED (uncompressed) entries, which is why it needs no
// dependency. Nothing else does: Excel, Numbers, LibreOffice and Sheets all
// re-save with DEFLATE, and they use the shared-strings table the writer never
// emits. A reader that only understood what the writer produced would fail on
// every file that had actually been edited — which is every file worth
// importing.
//
// Still no dependency: zlib is built in, and the zip central directory is a
// hundred lines of fixed-offset reads.

import zlib from 'node:zlib';

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

/** Every file in the archive, by name. Reads the CENTRAL DIRECTORY, not the
 *  local headers: a local header may carry zeroed sizes with the real values in
 *  a trailing data descriptor, which is legal and which Excel does emit. */
export function unzip(buf) {
  // End-of-central-directory, scanned backwards past any zip comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (u32(buf, p) !== 0x02014b50) break;
    const method = u16(buf, p + 10);
    const compSize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOff = u32(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // The local header's own name/extra lengths decide where the data starts;
    // the central directory's extra field is a different length.
    const lhNameLen = u16(buf, localOff + 26);
    const lhExtraLen = u16(buf, localOff + 28);
    const dataAt = localOff + 30 + lhNameLen + lhExtraLen;
    const raw = buf.slice(dataAt, dataAt + compSize);

    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`unsupported compression method ${method} for ${name}`);

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&'); // last, or an escaped &amp;lt; decodes twice

/** The shared-strings table every real editor writes. */
export function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // A string may be split across several <t> runs (rich text); concatenate.
    let s = '';
    for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += unescapeXml(t[1]);
    out.push(s);
  }
  return out;
}

/** A1 → 0, B1 → 1, AA1 → 26. Needed because empty cells are simply absent. */
export function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(String(ref ?? ''));
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One worksheet as an array of string rows. */
export function sheetRows(xml, strings) {
  const rows = [];
  for (const r of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of r[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const attrs = c[1] ?? c[3] ?? '';
      const body = c[2] ?? '';
      const at = colIndex(/r="([A-Z]+\d+)"/.exec(attrs)?.[1]);
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 'inlineStr') {
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) value += unescapeXml(t[1]);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v != null) value = type === 's' ? (strings[Number(v)] ?? '') : unescapeXml(v);
      }
      // Empty cells are omitted from the XML entirely, so position comes from
      // the r="" reference rather than from how many <c> elements preceded it.
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Read a workbook into { name, rows } sheets.
 *
 * Sheet ORDER follows workbook.xml rather than the zip's file order, which is
 * arbitrary — a caller asking for "the first sheet" means the first tab, not
 * whichever part the archive happened to store first.
 */
export function readXlsx(buf) {
  const files = unzip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const strings = sharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8'));

  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const target = new Map();
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1], m[2]);

  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = unescapeXml(/name="([^"]*)"/.exec(m[1])?.[1] ?? `Sheet${sheets.length + 1}`);
    const rid = /r:id="([^"]+)"/.exec(m[1])?.[1];
    let part = rid ? target.get(rid) : null;
    if (part && !part.startsWith('xl/')) part = `xl/${part.replace(/^\//, '')}`;
    const xml = part ? files.get(part)?.toString('utf8') : null;
    if (xml) sheets.push({ name, rows: sheetRows(xml, strings) });
  }
  // A workbook whose relationships could not be followed still has sheets on
  // disk; better to return them unnamed than to report an empty file.
  if (!sheets.length) {
    for (const [name, data] of files) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        sheets.push({ name, rows: sheetRows(data.toString('utf8'), strings) });
      }
    }
  }
  return sheets;
}

/** Header row + objects keyed by it — the shape a tracker importer wants. */
export function rowsToObjects(rows) {
  const [header, ...body] = rows ?? [];
  if (!header) return [];
  const keys = header.map((h) => String(h ?? '').trim());
  return body
    .filter((r) => r.some((c) => String(c ?? '').trim()))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, String(r[i] ?? '').trim()]).filter(([k]) => k)));
}
