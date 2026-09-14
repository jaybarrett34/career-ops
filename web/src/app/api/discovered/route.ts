import { readDiscovered, writeLock } from "@/lib/core/discovered-store";
import { withActiveProfile } from "@/lib/core/with-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The dynamic-expansion ledger: companies a trawl surfaced that portals.yml does
// not track. GET lists them for the active profile; POST sets one entry's lock.
//
// Company names here come from third-party listing feeds, which makes them
// UNTRUSTED CONTENT under AGENTS.md. Nothing in this route uses a name to build
// a path or a command — the only value that reaches the filesystem is the file
// name, which is a constant — and React escapes them on render.

const LOCKS = new Set(["open", "pinned", "dismissed"]);

async function handleGET() {
  const { rows, error } = readDiscovered();
  return Response.json({ discovered: rows, error });
}

async function handlePOST(req: Request) {
  let body: { id?: unknown; lock?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; lock?: unknown };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const lock = typeof body.lock === "string" ? body.lock : "";
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  if (!LOCKS.has(lock)) return Response.json({ error: `unknown lock: ${lock}` }, { status: 400 });

  // An id absent from the ledger is a 404, not a create. The ledger is written
  // by scans; letting a POST invent an entry would put a company in the file
  // that no scan ever saw.
  if (!writeLock(id, lock as "open" | "pinned" | "dismissed")) {
    return Response.json({ error: "no such entry" }, { status: 404 });
  }
  return Response.json({ ok: true, id, lock });
}

export const GET = withActiveProfile(handleGET);
export const POST = withActiveProfile(handlePOST);
