// Plain .mjs so tests/lib/files.test.mjs imports it directly under Node.

/**
 * The file surface: what the web app may list, accept and hand back.
 *
 * TWO DIRECTORIES, BOTH ALREADY MEANINGFUL TO career-ops
 *
 *   documents/  what the `intake` mode reads. Dropping a file here is how a
 *               master CV, a transcript or a reference letter enters the system.
 *   output/     where generated CVs and PDFs land.
 *
 * Deliberately not a general file browser. Those two are the only directories
 * with a defined role, and widening the surface widens what a bug can reach.
 *
 * PATH SAFETY IS THE WHOLE JOB HERE
 *
 * Every name that arrives from a request is attacker-controlled, and the result
 * is used to read or write a real file. So names are validated against a
 * conservative allowlist and REFUSED rather than sanitized: a cleaned hostile
 * name is still a name somebody chose, and silently rewriting it means the file
 * the user sees is not the file they sent.
 *
 * The containment check is done on the RESOLVED path, not the input string.
 * String-level checks for ".." miss URL-encoding, unicode lookalikes and
 * symlinks; comparing resolved prefixes catches all three.
 */

/** Directories the web app may touch, relative to the active root. */
export const FILE_ROOTS = Object.freeze({
  documents: { dir: "documents", label: "Documents", writable: true },
  output: { dir: "output", label: "Output", writable: false },
});

// Single path segment. No separators, no leading dot, no control characters.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}$/;

/** Extensions accepted on upload. Anything executable is absent on purpose. */
export const ALLOWED_UPLOAD_EXT = Object.freeze([
  ".pdf", ".md", ".txt", ".docx", ".doc", ".rtf", ".csv", ".tsv",
  ".json", ".yml", ".yaml", ".png", ".jpg", ".jpeg", ".webp",
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Is this a usable single-segment filename? */
export function isSafeName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) return false;
  // Reject a trailing dot or space: Windows silently strips them, so "a.txt."
  // and "a.txt" would name the same file on one platform and not another.
  if (/[ .]$/.test(name)) return false;
  return true;
}

export function extensionOf(name) {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

export function isAllowedUpload(name) {
  return isSafeName(name) && ALLOWED_UPLOAD_EXT.includes(extensionOf(name));
}

/**
 * Resolve `name` inside `rootKey`, or null if anything is off.
 *
 * @param {string} rootKey key of FILE_ROOTS
 * @param {string} name single filename
 * @param {string} dataRoot absolute active data root
 * @param {{join:(...a:string[])=>string, resolve:(...a:string[])=>string, sep:string}} pathApi
 */
export function resolveFilePath(rootKey, name, dataRoot, pathApi) {
  const spec = FILE_ROOTS[rootKey];
  if (!spec) return null;
  if (!isSafeName(name)) return null;
  const base = pathApi.resolve(dataRoot, spec.dir);
  const full = pathApi.resolve(base, name);
  // Containment on the RESOLVED path. The trailing separator matters: without
  // it, "/data/outputs-evil" passes a naive startsWith("/data/output") test.
  if (full !== base && !full.startsWith(base + pathApi.sep)) return null;
  return { base, full, spec };
}

/** Human size, for a listing. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}
