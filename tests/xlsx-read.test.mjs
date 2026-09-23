import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildXlsx, crc32 } from '../lib/xlsx.mjs';
import { readXlsx, rowsToObjects, unzip, sharedStrings, colIndex, sheetRows } from '../lib/xlsx-read.mjs';
import { matchRow } from '../workbook.mjs';

test('our own writer round-trips', () => {
  const buf = buildXlsx([{ name: 'Tracker', rows: [['a', 'b'], ['1', 'two'], ['3', '']] }]);
  const sheets = readXlsx(buf);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, 'Tracker');
  assert.deepEqual(sheets[0].rows[1], ['1', 'two']);
});

/**
 * A workbook shaped the way a real editor writes one: DEFLATE entries and a
 * sharedStrings table. Our writer emits neither, so a reader built only against
 * it would fail on every file that had actually been opened and saved — which
 * is every file worth importing.
 */
function excelStyleXlsx(headerAndRows) {
  const strings = [...new Set(headerAndRows.flat().filter((v) => v && isNaN(Number(v))))];
  const si = strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('');
  const col = (n) => String.fromCharCode(65 + n);
  const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + headerAndRows.map((row, r) => `<row r="${r + 1}">`
      + row.map((v, c) => {
        if (v === '' || v == null) return '';           // real editors omit empties
        const ref = `${col(c)}${r + 1}`;
        const idx = strings.indexOf(v);
        return idx >= 0 ? `<c r="${ref}" t="s"><v>${idx}</v></c>` : `<c r="${ref}"><v>${v}</v></c>`;
      }).join('') + '</row>').join('')
    + '</sheetData></worksheet>';

  const parts = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships/>'],
    ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet One" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<?xml version="1.0"?><sst count="${strings.length}">${si}</sst>`],
    ['xl/worksheets/sheet1.xml', sheet],
  ];

  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of parts) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const comp = zlib.deflateRawSync(data);          // DEFLATE, not STORED
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('a DEFLATE + sharedStrings workbook reads', () => {
  const buf = excelStyleXlsx([['Company', 'Status'], ['Acme', 'Applied'], ['Beta', 'Rejected']]);
  const sheets = readXlsx(buf);
  assert.equal(sheets[0].name, 'Sheet One', 'the tab name comes from workbook.xml, not the part name');
  assert.deepEqual(rowsToObjects(sheets[0].rows), [
    { Company: 'Acme', Status: 'Applied' },
    { Company: 'Beta', Status: 'Rejected' },
  ]);
});

test('an omitted empty cell does not shift the columns after it', () => {
  // Real editors leave empty cells out of the XML entirely, so position has to
  // come from the r="" reference. Counting <c> elements silently shifts every
  // later value one column left — a Status landing in the Notes column.
  const xml = '<row r="2"><c r="A2" t="inlineStr"><is><t>Acme</t></is></c>'
    + '<c r="C2" t="inlineStr"><is><t>Applied</t></is></c></row>';
  assert.deepEqual(sheetRows(xml, []), [['Acme', '', 'Applied']]);
});

test('column references past Z decode', () => {
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('Z9'), 25);
  assert.equal(colIndex('AA1'), 26);
  assert.equal(colIndex('AB12'), 27);
});

test('rich-text runs are joined rather than truncated', () => {
  // A string an editor split into formatted runs is still one value.
  assert.deepEqual(sharedStrings('<sst><si><r><t>Soft</t></r><r><t>ware</t></r></si></sst>'), ['Software']);
});

test('escaped entities decode once, not twice', () => {
  // &amp;lt; is a literal "&lt;", not a "<". Unescaping & first would produce
  // the wrong character.
  assert.deepEqual(sharedStrings('<sst><si><t>a &amp;lt; b &amp; c</t></si></sst>'), ['a &lt; b & c']);
});

test('blank rows are dropped when mapping to objects', () => {
  assert.deepEqual(rowsToObjects([['A', 'B'], ['', ''], ['1', '2']]), [{ A: '1', B: '2' }]);
});

test('a file that is not a zip fails with a clear message', () => {
  assert.throws(() => unzip(Buffer.from('this is a csv, actually')), /not a zip file/);
});

test('a sheet row matches a tracker row by number, then by company+role', () => {
  const tracker = [
    { num: 1, company: 'Acme', role: 'Software Engineer Intern', status: 'Evaluated' },
    { num: 2, company: 'Beta Corp', role: 'Data Engineer Intern', status: 'Evaluated' },
  ];
  assert.equal(matchRow({ '#': '2' }, tracker).row.num, 2);
  assert.equal(matchRow({ Company: 'acme', Role: 'software engineer intern' }, tracker).how, 'company+role');
  assert.equal(matchRow({ Company: 'Nobody' }, tracker), null);
});

test('an ambiguous company+role match is refused rather than guessed', () => {
  // Two applications to the same role at the same company are distinct rows;
  // picking one would silently move the wrong application's status.
  const tracker = [
    { num: 1, company: 'Acme', role: 'SWE Intern', status: 'Evaluated' },
    { num: 2, company: 'Acme', role: 'SWE Intern', status: 'Applied' },
  ];
  assert.equal(matchRow({ Company: 'Acme', Role: 'SWE Intern' }, tracker), null);
});
