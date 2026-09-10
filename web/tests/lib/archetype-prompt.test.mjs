import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";

const BASE = { input: "42", memory: "", today: "2026-09-10", postedAt: undefined, lang: undefined };
const AI = { id: "ai_engineer", label: "AI Engineer", tex: "tex/ai.tex", keywords: ["LLM", "RAG"], model: "opaque-model-id" };
const KINDS = ["research", "pdf", "evaluate"];

test("no archetype leaves every prompt kind unchanged", () => {
  for (const kind of KINDS) {
    const p = buildPrompt({ ...BASE, kind, archetype: null });
    assert.ok(!/ACTIVE ARCHETYPE/.test(p), `${kind} leaked an archetype note`);
  }
});

test("an active archetype reaches EVERY prompt kind", () => {
  // Folded into the shared `mem` string precisely so no branch can miss it —
  // a per-branch injection is how one kind silently stops honouring the
  // selection while the UI still shows it active.
  for (const kind of KINDS) {
    const p = buildPrompt({ ...BASE, kind, archetype: AI });
    assert.match(p, /ACTIVE ARCHETYPE: "AI Engineer"/, `${kind} lost the archetype`);
    assert.match(p, /id: ai_engineer/, `${kind} lost the id`);
  }
});

test("keywords are carried, with the never-invent rule attached", () => {
  const p = buildPrompt({ ...BASE, kind: "pdf", archetype: AI });
  assert.match(p, /LLM, RAG/);
  // The keywords are an emphasis hint, not a licence to claim skills. Losing
  // this clause would turn the overlay into a fabrication vector.
  assert.match(p, /never by inventing any/i);
  assert.match(p, /REAL experience/);
});

test("the tex path is offered as a source to READ, not as a command", () => {
  const p = buildPrompt({ ...BASE, kind: "pdf", archetype: AI });
  assert.match(p, /tex\/ai\.tex/);
  assert.match(p, /read it for structure and emphasis/i);
});

test("an archetype with no tex and no keywords still names itself, cleanly", () => {
  const bare = { id: "swe", label: "Software Engineer", tex: null, keywords: [], model: null };
  const p = buildPrompt({ ...BASE, kind: "pdf", archetype: bare });
  assert.match(p, /ACTIVE ARCHETYPE: "Software Engineer"/);
  assert.ok(!/undefined|null/.test(p.split("ACTIVE ARCHETYPE")[1].split("\n")[0]), "leaked a null/undefined");
});

test("the model id NEVER appears in a prompt", () => {
  // modes/_shared.md: its tier table is the only place model names live. The
  // model is applied as a --model flag on the invocation; an agent that could
  // read its own model id from the prompt invites it to reason about that.
  const p = buildPrompt({ ...BASE, kind: "pdf", archetype: AI });
  assert.ok(!p.includes("opaque-model-id"), "the model id leaked into the prompt");
});

test("the pdf prompt keeps its load-bearing envelope instruction", () => {
  // #2185: the envelope is what makes the agent emit the CV inline instead of
  // writing it. Adding the archetype note must not displace it.
  const p = buildPrompt({ ...BASE, kind: "pdf", archetype: AI });
  assert.match(p, /envelope/i);
  assert.match(p, /VERDICT:/);
});
