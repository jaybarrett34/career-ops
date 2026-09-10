import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newSessionId, isValidSessionId, deriveTitle, serializeMessages, normalizeSession, sortSessions,
} from "../../src/lib/core/chat-sessions.mjs";

// ── ids: the only thing that reaches a filesystem path ───────────────────────

test("generated ids are always path-safe", () => {
  for (let i = 0; i < 500; i++) {
    const id = newSessionId();
    assert.ok(isValidSessionId(id), `not valid: ${id}`);
    assert.ok(!/[/\\.\0]/.test(id), `contains a path character: ${id}`);
  }
});

test("ids are 16 chars even when the RNG returns its extremes", () => {
  assert.equal(newSessionId(() => 0).length, 16);
  assert.equal(newSessionId(() => 0.999999).length, 16);
});

test("TRAVERSAL: hostile ids are rejected before they can touch a path", () => {
  for (const bad of [
    "../../etc/passwd", "..", ".", "a/b", "a\\b", "with space", "UPPER",
    "sh0rt", "", null, undefined, 42, "x".repeat(64), "a.b", "a\0b",
  ]) {
    assert.equal(isValidSessionId(bad), false, `should reject: ${JSON.stringify(bad)}`);
  }
});

// ── titles ───────────────────────────────────────────────────────────────────

test("title comes from the first USER message, not the greeting", () => {
  const msgs = [
    { role: "assistant", parts: [{ type: "text", text: "Hi — I'm your career-ops assistant." }] },
    { role: "user", parts: [{ type: "text", text: "find me chicago internships" }] },
  ];
  assert.equal(deriveTitle(msgs, "2026-09-10T00:00:00Z"), "find me chicago internships");
});

test("an empty conversation gets a DATED title, never a row of identical 'Untitled'", () => {
  assert.equal(deriveTitle([], "2026-09-10T12:00:00Z"), "Chat 2026-09-10");
  assert.equal(deriveTitle([{ role: "assistant", parts: [{ type: "text", text: "hi" }] }], "2026-09-10T00:00:00Z"), "Chat 2026-09-10");
});

test("long titles are truncated with an ellipsis", () => {
  const long = "x".repeat(200);
  const t = deriveTitle([{ role: "user", parts: [{ type: "text", text: long }] }], "2026-09-10T00:00:00Z");
  assert.ok(t.length <= 40, `too long: ${t.length}`);
  assert.match(t, /…$/);
});

test("whitespace and newlines collapse so a pasted block does not become the title", () => {
  const t = deriveTitle([{ role: "user", parts: [{ type: "text", text: "  hello\n\n  world  " }] }], "2026-09-10T00:00:00Z");
  assert.equal(t, "hello world");
});

// ── serialization: the confirm-card rule ─────────────────────────────────────

test("PENDING confirm cards are never persisted", () => {
  // Restoring one would present a stale authorisation prompt for a write the
  // user last considered days ago, with none of the context that produced it.
  const msgs = [{ role: "assistant", parts: [
    { type: "text", text: "About to update the tracker." },
    { type: "confirm", cid: "c1", summary: "set #42 Applied", state: "pending" },
  ] }];
  const out = serializeMessages(msgs);
  assert.equal(out[0].parts.length, 1);
  assert.equal(out[0].parts[0].type, "text");
});

test("RESOLVED confirm cards are kept — they are history, not a live prompt", () => {
  const msgs = [{ role: "assistant", parts: [
    { type: "confirm", cid: "c1", summary: "set #42 Applied", state: "done" },
    { type: "confirm", cid: "c2", summary: "generate a PDF", state: "cancelled" },
  ] }];
  assert.equal(serializeMessages(msgs)[0].parts.length, 2);
});

test("a message left with no parts is dropped, not persisted empty", () => {
  const msgs = [{ role: "assistant", parts: [{ type: "confirm", cid: "c", summary: "s", state: "pending" }] }];
  assert.deepEqual(serializeMessages(msgs), []);
});

test("only the trailing window is kept", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ role: "user", parts: [{ type: "text", text: `m${i}` }] }));
  const out = serializeMessages(many, 10);
  assert.equal(out.length, 10);
  assert.equal(out[9].parts[0].text, "m499");
});

// ── normalizeSession: one corrupt file costs one tab ─────────────────────────

const ID = "abcdef0123456789";

test("a well-formed session round-trips with its profile binding", () => {
  const s = normalizeSession(
    { title: "T", rootId: "jay", archetypeId: "ai_engineer", createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-02T00:00:00Z", messages: [{ role: "user", parts: [] }] }, ID);
  assert.equal(s.meta.rootId, "jay");
  assert.equal(s.meta.archetypeId, "ai_engineer");
  assert.equal(s.meta.messageCount, 1);
});

test("garbage never throws, it just yields null", () => {
  for (const junk of [null, undefined, 42, "str", [], true]) {
    assert.equal(normalizeSession(junk, ID), null, `should be null: ${JSON.stringify(junk)}`);
  }
});

test("an invalid id is refused even when the body is perfect", () => {
  assert.equal(normalizeSession({ messages: [] }, "../../etc"), null);
});

test("missing fields are filled rather than dropping the session", () => {
  const s = normalizeSession({ messages: [] }, ID);
  assert.equal(s.meta.id, ID);
  assert.equal(s.meta.rootId, null);
  assert.ok(s.meta.title.startsWith("Chat "));
});

// ── ordering ─────────────────────────────────────────────────────────────────

test("sessions sort newest-updated first", () => {
  const metas = [
    { id: "a", updatedAt: "2026-09-01T00:00:00Z" },
    { id: "b", updatedAt: "2026-09-03T00:00:00Z" },
    { id: "c", updatedAt: "2026-09-02T00:00:00Z" },
  ];
  assert.deepEqual(sortSessions(metas).map((m) => m.id), ["b", "c", "a"]);
});

test("sorting does not mutate its input", () => {
  const metas = [{ id: "a", updatedAt: "2026-09-01T00:00:00Z" }, { id: "b", updatedAt: "2026-09-03T00:00:00Z" }];
  const before = metas.map((m) => m.id);
  sortSessions(metas);
  assert.deepEqual(metas.map((m) => m.id), before);
});
