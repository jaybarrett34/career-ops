import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { activeProfile } from "@/lib/core/active-profile-types";
import { withActiveProfile } from "@/lib/core/with-profile";
import { atomicWrite } from "@/lib/core/safe-write";
import {
  newSessionId, isValidSessionId, deriveTitle, serializeMessages, normalizeSession, sortSessions,
} from "@/lib/core/chat-sessions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chat sessions for the ACTIVE profile. Stored under the active root, so a
// conversation held as one person is not visible while acting as another — the
// same isolation the tracker already has. See chat-sessions.mjs for the trade.

function chatsDir(): string {
  return path.join(careerOpsRoot(), ".career-ops-web", "chats");
}

function sessionPath(id: string): string | null {
  // The ONLY place an id becomes a path. Anything not matching the generated
  // shape is refused here rather than sanitized, because a "cleaned" hostile id
  // is still an id somebody chose.
  if (!isValidSessionId(id)) return null;
  return path.join(chatsDir(), `${id}.json`);
}

function readAll(): ReturnType<typeof normalizeSession>[] {
  let names: string[];
  try {
    names = fs.readdirSync(chatsDir());
  } catch {
    return []; // no chats yet
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const id = n.slice(0, -5);
    const p = sessionPath(id);
    if (!p) continue; // a stray file with a hostile name is ignored, not read
    try {
      const s = normalizeSession(JSON.parse(fs.readFileSync(p, "utf8")), id);
      if (s) out.push(s);
    } catch {
      // One corrupt file costs one tab, never the tab bar.
    }
  }
  return out;
}

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const p = sessionPath(id);
    if (!p) return Response.json({ error: "bad id" }, { status: 400 });
    try {
      const s = normalizeSession(JSON.parse(fs.readFileSync(p, "utf8")), id);
      if (!s) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(s);
    } catch {
      return Response.json({ error: "not found" }, { status: 404 });
    }
  }

  const prof = activeProfile();
  return Response.json({
    sessions: sortSessions(readAll().map((s) => s!.meta)),
    activeRootId: prof?.rootId ?? null,
    activeArchetypeId: prof?.archetypeId ?? null,
  });
}

async function handlePOST(req: Request) {
  let body: { id?: string; messages?: unknown[]; title?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const id = body.id && isValidSessionId(body.id) ? body.id : newSessionId();
  const p = sessionPath(id);
  if (!p) return Response.json({ error: "bad id" }, { status: 400 });

  const now = new Date().toISOString();
  const messages = serializeMessages(body.messages as never[]);
  const prof = activeProfile();

  // Preserve createdAt across saves so tab age stays meaningful.
  let createdAt = now;
  try {
    const prev = JSON.parse(fs.readFileSync(p, "utf8"));
    if (typeof prev.createdAt === "string") createdAt = prev.createdAt;
  } catch {
    /* new session */
  }

  const payload = {
    title: body.title?.trim() || deriveTitle(messages, createdAt),
    // The binding is recorded at save time so a transcript always says which
    // person and flavor produced it, even after the cookies change.
    rootId: prof?.rootId ?? null,
    archetypeId: prof?.archetypeId ?? null,
    createdAt,
    updatedAt: now,
    messages,
  };

  try {
    fs.mkdirSync(chatsDir(), { recursive: true });
    atomicWrite(p, JSON.stringify(payload, null, 2));
  } catch (e) {
    // Disk failure must not lose the live transcript; the client keeps it and
    // falls back to localStorage.
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, id, title: payload.title, updatedAt: now });
}

async function handleDELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const p = id ? sessionPath(id) : null;
  if (!p) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    fs.unlinkSync(p);
  } catch {
    /* already gone — deleting twice is not an error */
  }
  return Response.json({ ok: true });
}

// Establishes the per-request profile scope; see lib/core/with-profile.ts.
export const GET = withActiveProfile(handleGET);
export const POST = withActiveProfile(handlePOST);
export const DELETE = withActiveProfile(handleDELETE);
