// Plain .mjs so tests/lib/export.test.mjs imports it directly under Node.

/**
 * CSV and JSON export of the active profile's own data.
 *
 * WHY CSV AT ALL, when the tracker is already a readable markdown table:
 * markdown is the working format, spreadsheets are where people actually sort,
 * pivot and share. An export is also the honest answer to lock-in — the data is
 * the user's, and it should leave in a format nothing here controls.
 *
 * CSV ESCAPING IS THE WHOLE RISK
 *
 * Two separate hazards, and they are not the same thing:
 *
 *   1. Structural — a comma, quote or newline inside a cell corrupts the row
 *      shape. Handled by RFC 4180 quoting.
 *   2. FORMULA INJECTION — a cell beginning with =, +, -, @, tab or carriage
 *      return is executed by Excel, Google Sheets and LibreOffice when opened.
 *      A job title like "=cmd|..." or a note pasted from a posting is a real
 *      vector, and this data comes from scraped job boards. Such cells are
 *      prefixed with a single quote, which spreadsheets treat as "literal text"
 *      and which is invisible in the cell.
 *
 * Quoting alone does NOT stop the second one: "=1+1" is still a formula.
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** One CSV cell: neutralized against formulas, then RFC 4180 quoted. */
export function csvCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  // Neutralize BEFORE quoting: a spreadsheet strips the quotes and then reads
  // the leading character, so the order matters.
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Rows to CSV. `columns` is [{key,label}] so the header is stable and the
 * column order does not depend on object key order.
 */
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = (rows ?? []).map((r) => columns.map((c) => csvCell(r?.[c.key])).join(","));
  // CRLF: the line ending RFC 4180 specifies and the one Excel expects.
  return [head, ...body].join("\r\n") + "\r\n";
}

export const TRACKER_COLUMNS = Object.freeze([
  { key: "n", label: "#" },
  { key: "date", label: "Date" },
  { key: "company", label: "Company" },
  { key: "role", label: "Role" },
  { key: "score", label: "Score" },
  { key: "status", label: "Status" },
  { key: "via", label: "Via" },
  { key: "pdf", label: "PDF" },
  { key: "report", label: "Report" },
  { key: "notes", label: "Notes" },
]);

export const PIPELINE_COLUMNS = Object.freeze([
  { key: "company", label: "Company" },
  { key: "role", label: "Role" },
  { key: "location", label: "Location" },
  { key: "compensation", label: "Compensation" },
  { key: "postedAt", label: "Posted" },
  { key: "done", label: "Done" },
  { key: "url", label: "URL" },
]);

/** Filename for an export. Dated, so two downloads never collide in Downloads/. */
export function exportFilename(what, ext, today) {
  const safe = String(what).replace(/[^a-z0-9-]/gi, "");
  return `career-ops-${safe}-${today}.${ext}`;
}
