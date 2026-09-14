// Minimal .xlsx writer. No dependency: an xlsx is a zip of XML, and a stored
// (uncompressed) zip is a few hundred bytes of headers that Excel, Numbers and
// LibreOffice all accept.

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Excel rejects a file containing raw control characters; strip rather than
// fail, since this data comes from scraped postings.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(CONTROL, '');

function colName(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function sheetXml(rows) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  rows.forEach((row, r) => {
    out.push(`<row r="${r + 1}">`);
    row.forEach((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      // A leading-zero string like "007" is text, not a number; typed numeric,
      // Excel would eat the zeros.
      const raw = String(v ?? '');
      const isNum = typeof v === 'number' || (NUMERIC.test(raw) && !/^-?0\d/.test(raw));
      if (v === null || v === undefined || v === '') out.push(`<c r="${ref}"/>`);
      else if (isNum) out.push(`<c r="${ref}"><v>${esc(v)}</v></c>`);
      else out.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
    });
    out.push('</row>');
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const ODR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * @param {{name: string, rows: (string|number|null)[][]}[]} sheets
 * @returns {Buffer} a .xlsx
 */
export function buildXlsx(sheets) {
  const safe = (sheets ?? []).map((s, i) => ({
    // Excel caps sheet names at 31 chars and forbids : \ / ? * [ ]
    name: (s.name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, '-').slice(0, 31),
    rows: s.rows ?? [],
  }));
  if (!safe.length) safe.push({ name: 'Sheet1', rows: [] });

  const files = [
    { name: '[Content_Types].xml', data: DECL
      + `<Types xmlns="${CT}">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>' },
    { name: '_rels/.rels', data: DECL
      + `<Relationships xmlns="${REL}">`
      + `<Relationship Id="rId1" Type="${ODR}/officeDocument" Target="xl/workbook.xml"/>`
      + '</Relationships>' },
    { name: 'xl/workbook.xml', data: DECL
      + `<workbook xmlns="${SS}" xmlns:r="${ODR}"><sheets>`
      + safe.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: DECL
      + `<Relationships xmlns="${REL}">`
      + safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ODR}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + '</Relationships>' },
    ...safe.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) })),
  ];
  return zip(files);
}
