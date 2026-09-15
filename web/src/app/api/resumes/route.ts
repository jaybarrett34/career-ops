import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { withActiveProfile } from "@/lib/core/with-profile";
import { inventory, fileForId } from "@/lib/core/resume-inventory.mjs";
import { validateLibrary, selectBullets } from "@/lib/core/bullets.mjs";
import { buildFingerprint } from "@/lib/core/build-fingerprint.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where each resume lives on disk and whether its PDF is current, plus streaming
// one of them for preview.
//
// Requests name an `id`; paths come from config/resumes.yml, which is
// hand-edited and is the only source of servable locations here. No request can
// name a path, so none can reach a file the config does not already point at.
// That matters more than usual on this route: the .tex templates deliberately
// live outside the data root, so the Files route's containment check does not
// apply and the id indirection is the whole guard.

const fsq = {
  exists: (p: string) => fs.existsSync(p),
  stat: (p: string) => {
    try {
      const st = fs.statSync(p);
      return st.isFile() ? { mtimeMs: st.mtimeMs, size: st.size } : null;
    } catch {
      return null;
    }
  },
  resolve: (...a: string[]) => path.resolve(...a),
  readJson: (p: string) => {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
  },
};

function readInventory() {
  const root = careerOpsRoot();
  let resumes: unknown[] = [];
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, "config", "resumes.yml"), "utf8")) as
      { resumes?: unknown[] } | null;
    resumes = Array.isArray(doc?.resumes) ? doc.resumes : [];
  } catch {
    /* absent config is an empty inventory, not an error */
  }
  // Recompute what each resume WOULD render today, so the comparison against the
  // sidecar is exact rather than an mtime guess.
  type Bullet = { id: string; text: string; rendered?: string };
  let library: Bullet[] = [];
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, "config", "bullets.yml"), "utf8")) as
      { bullets?: unknown[] } | null;
    library = validateLibrary(Array.isArray(doc?.bullets) ? doc.bullets : []).bullets as Bullet[];
  } catch {
    /* no library: staleness falls back to mtimes */
  }

  const fingerprintOf = (r: { template?: string; bullets?: string[] }) => {
    if (!library.length || !r?.template) return null;
    try {
      const template = fs.readFileSync(path.resolve(root, r.template), "utf8");
      const { picked } = selectBullets(library, r.bullets ?? []);
      return buildFingerprint(picked, template);
    } catch {
      return null;
    }
  };

  return inventory(resumes as Parameters<typeof inventory>[0], root, fsq, { fingerprintOf });
}

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const which = url.searchParams.get("file");
  const inv = readInventory();

  if (!id) return Response.json({ resumes: inv, root: careerOpsRoot() });

  if (which !== "pdf" && which !== "tex") {
    return Response.json({ error: "file must be pdf or tex" }, { status: 400 });
  }
  const abs = fileForId(inv, id, which);
  if (!abs) return Response.json({ error: "no such resume, or it has not been built" }, { status: 404 });

  let body: Buffer;
  try {
    body = fs.readFileSync(abs);
  } catch {
    return Response.json({ error: "file vanished" }, { status: 404 });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": which === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
      // inline so the browser previews it rather than downloading; the filename
      // is built from the id, which the config already vouched for.
      "Content-Disposition": `inline; filename="${id}.${which}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

export const GET = withActiveProfile(handleGET);
