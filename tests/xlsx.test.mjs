import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildXlsx, crc32 } from '../lib/xlsx.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'b.xlsx');

function inspect(buf) {
  const p = tmp(); fs.writeFileSync(p, buf);
  const out = execFileSync('python3', ['-c', `
import zipfile,sys,json,xml.dom.minidom as md
z=zipfile.ZipFile(sys.argv[1])
bad=z.testzip()
parts={}
for n in z.namelist():
    md.parseString(z.read(n))
    parts[n]=z.read(n).decode('utf-8','replace')
print(json.dumps({"crcOk":bad is None,"names":z.namelist(),"parts":parts}))`, p], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('crc32 matches the known check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('a workbook is a valid zip with well-formed XML throughout', () => {
  const r = inspect(buildXlsx([{ name: 'A', rows: [['x']] }]));
  assert.equal(r.crcOk, true);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    assert.ok(r.names.includes(n), `missing ${n}`);
});

test('every sheet gets a part, a content-type override and a relationship', () => {
  const r = inspect(buildXlsx([{ name: 'A', rows: [] }, { name: 'B', rows: [] }, { name: 'C', rows: [] }]));
  assert.ok(r.names.includes('xl/worksheets/sheet3.xml'));
  assert.equal((r.parts['[Content_Types].xml'].match(/worksheet\+xml/g) || []).length, 3);
  assert.equal((r.parts['xl/_rels/workbook.xml.rels'].match(/worksheets\/sheet/g) || []).length, 3);
});

test('XML metacharacters in data cannot break the sheet', () => {
  const r = inspect(buildXlsx([{ name: 'A', rows: [['Acme & Co <script>', '"quoted"']] }]));
  assert.match(r.parts['xl/worksheets/sheet1.xml'], /Acme &amp; Co &lt;script&gt;/);
});

test('control characters are stripped rather than producing an unopenable file', () => {
  const nasty = 'a' + String.fromCharCode(7) + 'b';
  const r = inspect(buildXlsx([{ name: 'A', rows: [[nasty]] }]));
  assert.match(r.parts['xl/worksheets/sheet1.xml'], />ab</);
});

test('numbers are numeric but leading-zero strings stay text', () => {
  const r = inspect(buildXlsx([{ name: 'A', rows: [[42, '3.5', '007', '-0012']] }]));
  const s = r.parts['xl/worksheets/sheet1.xml'];
  assert.match(s, /<c r="A1"><v>42<\/v><\/c>/);
  assert.match(s, /<c r="B1"><v>3.5<\/v><\/c>/);
  assert.match(s, /r="C1" t="inlineStr"/);
  assert.match(s, /r="D1" t="inlineStr"/);
});

test('empty cells are emitted without a value', () => {
  const r = inspect(buildXlsx([{ name: 'A', rows: [[null, undefined, '', 'x']] }]));
  const s = r.parts['xl/worksheets/sheet1.xml'];
  assert.match(s, /<c r="A1"\/>/);
  assert.match(s, /<c r="C1"\/>/);
});

test('column names continue past Z', () => {
  const r = inspect(buildXlsx([{ name: 'A', rows: [Array.from({ length: 28 }, (_, i) => `c${i}`)] }]));
  const s = r.parts['xl/worksheets/sheet1.xml'];
  assert.ok(s.includes('r="Z1"') && s.includes('r="AA1"') && s.includes('r="AB1"'));
});

test('illegal sheet-name characters and over-length names are corrected', () => {
  const r = inspect(buildXlsx([{ name: 'a/b:c*d?e[f]g', rows: [] }, { name: 'x'.repeat(50), rows: [] }]));
  const wb = r.parts['xl/workbook.xml'];
  assert.ok(!/name="[^"]*[\\/:*?[\]][^"]*"/.test(wb), wb);
  const names = [...wb.matchAll(/name="([^"]*)"/g)].map((m) => m[1]);
  for (const n of names) assert.ok(n.length <= 31, `${n} too long`);
});

test('no sheets still yields an openable workbook', () => {
  const r = inspect(buildXlsx([]));
  assert.equal(r.crcOk, true);
  assert.ok(r.names.includes('xl/worksheets/sheet1.xml'));
});
