import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv, exportFilename, TRACKER_COLUMNS } from "../../src/lib/core/export.mjs";

test("plain values pass through unquoted", () => {
  assert.equal(csvCell("Acme"), "Acme");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("structural characters are RFC 4180 quoted", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

test("FORMULA INJECTION is neutralized, not merely quoted", () => {
  // The real hazard: this data comes from scraped job boards, and Excel,
  // Sheets and LibreOffice all execute a cell that starts with these.
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    const out = csvCell(`${lead}cmd|' /c calc'!A1`);
    assert.ok(out.startsWith("'") || out.startsWith("\"'"),
      `lead ${JSON.stringify(lead)} was not neutralized: ${out}`);
  }
});

test("quoting alone would not have been enough", () => {
  // "=1+1" is still a formula to a spreadsheet once it strips the quotes.
  const out = csvCell("=1+1");
  assert.ok(out.includes("'=1+1"), `expected a literal-text prefix, got ${out}`);
});

test("a negative NUMBER is still neutralized, and that is correct", () => {
  // -5 leads with a formula character. Prefixing costs a leading quote in the
  // cell; not prefixing means "-5+1" evaluates. Safety wins, and the value
  // still reads correctly.
  assert.equal(csvCell("-5"), "'-5");
});

test("toCsv writes a stable header and CRLF rows", () => {
  const csv = toCsv([{ a: 1, b: "x" }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]);
  assert.equal(csv, "A,B\r\n1,x\r\n");
});

test("column order comes from the spec, not object key order", () => {
  const csv = toCsv([{ b: "second", a: "first" }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]);
  assert.equal(csv.split("\r\n")[1], "first,second");
});

test("a missing key yields an empty cell rather than 'undefined'", () => {
  const csv = toCsv([{ a: 1 }], TRACKER_COLUMNS.slice(0, 3));
  assert.ok(!csv.includes("undefined"), csv);
});

test("no rows still produces a usable header", () => {
  assert.equal(toCsv([], [{ key: "a", label: "A" }]), "A\r\n");
  assert.equal(toCsv(null, [{ key: "a", label: "A" }]), "A\r\n");
});

test("filenames are dated and path-safe", () => {
  assert.equal(exportFilename("tracker", "csv", "2026-09-11"), "career-ops-tracker-2026-09-11.csv");
  assert.equal(exportFilename("../../etc/passwd", "csv", "2026-09-11"), "career-ops-etcpasswd-2026-09-11.csv");
});
