import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("kind selects the contents in every format, not only CSV", () => {
  // The filename is built from `kind` in all three formats, so when json and
  // xlsx ignored it you downloaded "career-ops-tracker-<date>.xlsx" holding
  // thousands of pipeline rows. A file whose name misdescribes its contents is
  // worse than one that is merely large.
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../src/app/api/export/route.ts"), "utf8");

  // Both selectors exist and are derived from kind.
  assert.match(src, /const wantTracker = kind === "tracker" \|\| kind === "all"/);
  assert.match(src, /const wantPipeline = kind === "pipeline" \|\| kind === "all"/);

  // The xlsx branch builds its sheet list conditionally rather than always both.
  const xlsx = src.slice(src.indexOf('if (format === "xlsx")'), src.indexOf("let body"));
  assert.match(xlsx, /if \(wantTracker\) sheets\.push/);
  assert.match(xlsx, /if \(wantPipeline\) sheets\.push/);
  // buildXlsx receives the array that was built conditionally, never an inline
  // literal -- an inline literal is how both sheets shipped regardless of kind.
  assert.match(xlsx, /buildXlsx\(sheets\)/);
  assert.equal((xlsx.match(/sheets\.push/g) || []).length, 2, "each sheet is pushed once, behind its own guard");

  // The json branch spreads each dataset behind its own selector.
  assert.match(src, /\.\.\.\(wantTracker \? \{ tracker: readApplications\(\) \} : \{\}\)/);
  assert.match(src, /\.\.\.\(wantPipeline \? \{ pipeline: readInbox\(\) \} : \{\}\)/);
});
