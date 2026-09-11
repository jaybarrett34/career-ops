import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { withActiveProfile } from "@/lib/core/with-profile";
import {
  FILE_ROOTS, isAllowedUpload, isSafeName, resolveFilePath,
  MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT,
} from "@/lib/core/files.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upload into documents/ and download from documents/ or output/, scoped to the
// ACTIVE profile's data root. See files.mjs for the path-safety rules; every
// name that arrives here is attacker-controlled and is refused rather than
// cleaned.

const P = { join: path.join, resolve: path.resolve, sep: path.sep };

function listDir(rootKey: keyof typeof FILE_ROOTS) {
  const dir = path.resolve(careerOpsRoot(), FILE_ROOTS[rootKey].dir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // absent directory is empty, not an error
  }
  const out = [];
  for (const name of names) {
    // A stray file whose name we would refuse to serve is not listed either:
    // showing something undownloadable is worse than not showing it.
    if (!isSafeName(name)) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (!st.isFile()) continue;
      out.push({ name, bytes: st.size, modified: st.mtime.toISOString(), root: rootKey });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  const rootKey = (url.searchParams.get("root") || "documents") as keyof typeof FILE_ROOTS;

  if (!name) {
    return Response.json({
      roots: Object.entries(FILE_ROOTS).map(([k, v]) => ({ key: k, label: v.label, writable: v.writable })),
      files: [...listDir("documents"), ...listDir("output")],
      allowedExtensions: ALLOWED_UPLOAD_EXT,
      maxBytes: MAX_UPLOAD_BYTES,
    });
  }

  const r = resolveFilePath(rootKey, name, careerOpsRoot(), P);
  if (!r) return Response.json({ error: "bad name" }, { status: 400 });
  let buf: Buffer;
  try {
    buf = fs.readFileSync(r.full);
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      // application/octet-stream, always: serving a user-supplied file under its
      // own guessed type is how an uploaded .html becomes stored XSS on this
      // origin. The download is the feature; rendering it is not.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handlePOST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: `too large (limit ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB)` }, { status: 413 });
  }
  // The browser-supplied name can contain anything; take only its last segment
  // before validating, then refuse rather than rewrite.
  const raw = (file.name || "").split(/[\\/]/).pop() || "";
  if (!isAllowedUpload(raw)) {
    return Response.json({ error: `name or type not allowed: ${raw || "(empty)"}` }, { status: 400 });
  }
  // documents/ only. output/ is generated, and letting uploads land there would
  // mean a tailored CV could be silently replaced by an uploaded file.
  const r = resolveFilePath("documents", raw, careerOpsRoot(), P);
  if (!r) return Response.json({ error: "bad name" }, { status: 400 });

  try {
    fs.mkdirSync(r.base, { recursive: true });
    // Never clobber. A collision gets a suffix and the real name is returned,
    // so the user is never told they uploaded something they overwrote.
    let target = r.full;
    if (fs.existsSync(target)) {
      const ext = path.extname(raw);
      const stem = path.basename(raw, ext);
      target = path.join(r.base, `${stem}-${Date.now()}${ext}`);
    }
    fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()));
    return Response.json({ ok: true, name: path.basename(target), root: "documents" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
}

async function handleDELETE(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  // Deletion is limited to documents/. output/ holds generated artifacts the
  // tracker may reference; removing one from here would leave a dangling link.
  const r = name ? resolveFilePath("documents", name, careerOpsRoot(), P) : null;
  if (!r) return Response.json({ error: "bad name" }, { status: 400 });
  try {
    fs.unlinkSync(r.full);
  } catch {
    /* already gone */
  }
  return Response.json({ ok: true });
}

// Establishes the per-request profile scope; see lib/core/with-profile.ts.
export const GET = withActiveProfile(handleGET);
export const POST = withActiveProfile(handlePOST);
export const DELETE = withActiveProfile(handleDELETE);
