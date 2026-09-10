// Plain .mjs so tests/lib/chat-sessions.test.mjs imports it directly under Node.

/**
 * Chat sessions — the tab model behind the assistant console.
 *
 * WHERE TRANSCRIPTS LIVE, AND WHY IT MATTERS
 *
 * Under `<active root>/.career-ops-web/chats/`. That directory is already
 * gitignored and already resolves through careerOpsRoot(), which is now
 * profile-aware — so a conversation held while acting as one person is stored
 * with THAT person's data, not pooled in the install.
 *
 * The consequence is deliberate: **tabs are scoped to the active root.**
 * Switching person switches which conversations you see. A transcript about one
 * person's job search is not visible while acting as another, which is the same
 * isolation the tracker and reports already get. The cost is that you cannot see
 * every conversation at once; that is the correct trade for a tool whose central
 * failure mode is acting on the wrong person's data.
 *
 * PERSISTENCE IS TO DISK, NOT localStorage
 *
 * The previous console kept one transcript in a single localStorage key, so a
 * new topic destroyed the old one and cleared browser data lost everything.
 * Disk also makes transcripts readable by the CLI itself, which the assistant
 * prompt already assumes for `.career-ops-web/runs/{id}.md`.
 */

/** @typedef {{id: string, title: string, rootId: string|null, archetypeId: string|null, createdAt: string, updatedAt: string, messageCount: number}} SessionMeta */

const ID_RE = /^[a-z0-9]{8,32}$/;

/**
 * A session id that is safe as a FILENAME.
 *
 * Lowercase alphanumerics only, no separators, no dots. Ids are concatenated
 * into a path, so anything that could contain `/`, `..` or a null byte would be
 * a traversal primitive — and unlike a root id, these are generated rather than
 * user-supplied, so the constraint costs nothing.
 *
 * @param {() => number} rnd
 */
export function newSessionId(rnd = Math.random) {
  let s = "";
  while (s.length < 16) s += Math.floor(rnd() * 36 ** 8).toString(36);
  return s.slice(0, 16).padEnd(16, "0");
}

/** Is this a well-formed session id? The ONLY gate before an id touches a path. */
export function isValidSessionId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * Derive a tab title from the first user message.
 *
 * Falls back to a dated label rather than "Untitled": a row of identical
 * "Untitled" tabs is indistinguishable, which defeats the point of tabs.
 *
 * @param {{role: string, parts?: {type: string, text?: string}[]}[]} messages
 * @param {string} isoDate
 */
export function deriveTitle(messages, isoDate) {
  const firstUser = (messages ?? []).find((m) => m.role === "user");
  const text = (firstUser?.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return `Chat ${isoDate.slice(0, 10)}`;
  return text.length <= 40 ? text : text.slice(0, 39).trimEnd() + "…";
}

/**
 * Strip a transcript to what is safe and useful to persist.
 *
 * Drops PENDING confirm cards specifically. A confirm card is an unanswered
 * request to perform a write; persisting one and restoring it later would
 * present a stale authorisation prompt whose context the user no longer has —
 * and a click on it would perform a write they last considered days ago. The
 * previous single-transcript code dropped them for the same reason; keeping that
 * behavior is not optional.
 *
 * @param {any[]} messages
 * @param {number} keep How many trailing messages to retain.
 */
export function serializeMessages(messages, keep = 200) {
  return (messages ?? [])
    .slice(-keep)
    .map((m) => ({
      role: m.role,
      parts: (m.parts ?? []).filter((p) => !(p.type === "confirm" && p.state === "pending")),
    }))
    .filter((m) => m.parts.length > 0);
}

/**
 * Normalize a session file read off disk. Never throws — a corrupt file must
 * cost one tab, never the whole tab bar.
 *
 * @param {unknown} parsed
 * @param {string} id
 * @returns {{meta: SessionMeta, messages: any[]}|null}
 */
export function normalizeSession(parsed, id) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = /** @type {Record<string, any>} */ (parsed);
  if (!isValidSessionId(id)) return null;
  const messages = Array.isArray(o.messages) ? o.messages : [];
  const created = typeof o.createdAt === "string" ? o.createdAt : new Date(0).toISOString();
  return {
    meta: {
      id,
      title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : deriveTitle(messages, created),
      rootId: typeof o.rootId === "string" ? o.rootId : null,
      archetypeId: typeof o.archetypeId === "string" ? o.archetypeId : null,
      createdAt: created,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : created,
      messageCount: messages.length,
    },
    messages,
  };
}

/** Newest first — the order a tab bar wants. */
export function sortSessions(metas) {
  return [...metas].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}
