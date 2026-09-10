import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { cookies } from "next/headers";
import { defaultCareerOpsRoot } from "@/lib/career-ops";
import { normalizeRoots, checkRoot } from "@/lib/core/roots.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reads and switches the active profile (layer 1: which person's data).
//
// Deliberately NOT wrapped in withActiveProfile: this route is what CHOOSES the
// root, so it must read the install's own registry rather than whichever profile
// is currently active. Everything here uses defaultCareerOpsRoot() for that
// reason. entry-point-coverage.test.mjs does not flag it because it never calls
// careerOpsRoot().

const ROOT_COOKIE = "career-ops-root";
const ARCHETYPE_COOKIE = "career-ops-archetype";
// A year: the active profile is a workspace choice, not a session detail. It is
// re-validated against the registry on every request regardless, so a stale
// cookie can never do more than fall back.
const MAX_AGE = 60 * 60 * 24 * 365;

const fsq = {
  exists: (p: string) => fs.existsSync(p),
  isDir: (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  resolve: (...a: string[]) => path.resolve(...a),
};

function readRegistry() {
  const file = path.join(defaultCareerOpsRoot(), "config", "roots.yml");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { roots: [], errors: [] as string[] };
  }
  try {
    return normalizeRoots(yaml.load(raw));
  } catch (e) {
    return { roots: [], errors: [`config/roots.yml is not valid YAML: ${e instanceof Error ? e.message : e}`] };
  }
}

export async function GET() {
  const { roots, errors } = readRegistry();
  const jar = await cookies();
  const activeId = jar.get(ROOT_COOKIE)?.value ?? null;

  // The absolute path is deliberately NOT returned. The UI needs a label and an
  // id; shipping the path to the client would put a filesystem map of every
  // person's data into the page source for no functional gain.
  const items = roots.map((r) => {
    const v = checkRoot(r, fsq);
    return {
      id: r.id,
      label: r.label,
      enabled: r.enabled,
      usable: v.ok,
      reason: v.ok ? null : v.reason,
      active: activeId !== null && r.id.toLowerCase() === activeId.toLowerCase(),
    };
  });

  return Response.json({
    // configured:false means no config/roots.yml — the single-person case, where
    // the UI hides the switcher entirely.
    configured: items.length > 0,
    activeId,
    activeArchetypeId: jar.get(ARCHETYPE_COOKIE)?.value ?? null,
    roots: items,
    errors,
  });
}

export async function POST(req: Request) {
  let body: { rootId?: string | null; archetypeId?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const jar = await cookies();

  // rootId === null clears the selection and returns to the install default.
  if (body.rootId === null) {
    jar.delete(ROOT_COOKIE);
  } else if (typeof body.rootId === "string") {
    const { roots } = readRegistry();
    const wanted = body.rootId;
    const match = roots.find((r) => r.id.toLowerCase() === wanted.toLowerCase());
    // Refuse an unknown id LOUDLY here, unlike the request path which falls back
    // silently. A deliberate switch that quietly does nothing is worse than an
    // error: the user would believe they had changed person.
    if (!match) return Response.json({ error: `unknown root: ${wanted}` }, { status: 400 });
    const v = checkRoot(match, fsq);
    if (!v.ok) return Response.json({ error: `cannot switch to "${match.id}": ${v.reason}` }, { status: 409 });
    jar.set(ROOT_COOKIE, match.id, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE,
      // No `secure`: this is a local-first app served over http://localhost.
    });
  }

  if (body.archetypeId === null) jar.delete(ARCHETYPE_COOKIE);
  else if (typeof body.archetypeId === "string") {
    jar.set(ARCHETYPE_COOKIE, body.archetypeId, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE,
    });
  }

  return Response.json({ ok: true });
}
