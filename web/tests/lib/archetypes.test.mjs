import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeArchetypes, resolveArchetype, archetypeNoteSegment } from "../../src/lib/core/archetypes.mjs";

// ── normalizeArchetypes ──────────────────────────────────────────────────────

test("absent registry yields nothing and no complaint", () => {
  assert.deepEqual(normalizeArchetypes(undefined), { archetypes: [], errors: [] });
  assert.deepEqual(normalizeArchetypes(null), { archetypes: [], errors: [] });
});

test("accepts a bare list and a mapping with archetypes:", () => {
  const e = [{ id: "swe" }];
  assert.equal(normalizeArchetypes(e).archetypes.length, 1);
  assert.equal(normalizeArchetypes({ archetypes: e }).archetypes.length, 1);
});

test("only id is required; label defaults to id, the rest to empty", () => {
  const a = normalizeArchetypes([{ id: "swe" }]).archetypes[0];
  assert.deepEqual(a, { id: "swe", label: "swe", tex: null, keywords: [], model: null });
});

test("a full entry round-trips", () => {
  const a = normalizeArchetypes([
    { id: "ai_engineer", label: "AI Engineer", tex: "tex/ai.tex", keywords: ["LLM", "RAG"], model: "some-model-id" },
  ]).archetypes[0];
  assert.equal(a.label, "AI Engineer");
  assert.equal(a.tex, "tex/ai.tex");
  assert.deepEqual(a.keywords, ["LLM", "RAG"]);
  assert.equal(a.model, "some-model-id");
});

test("blank keywords are dropped, not carried as empty strings", () => {
  const a = normalizeArchetypes([{ id: "x", keywords: ["  ", "real", ""] }]).archetypes[0];
  assert.deepEqual(a.keywords, ["real"]);
});

test("keywords of the wrong type are reported, and the entry still loads", () => {
  const { archetypes, errors } = normalizeArchetypes([{ id: "x", keywords: "LLM" }]);
  assert.equal(archetypes.length, 1);
  assert.deepEqual(archetypes[0].keywords, []);
  assert.match(errors[0], /keywords must be a list/);
});

test("one malformed entry is dropped, the rest survive", () => {
  const { archetypes, errors } = normalizeArchetypes([{ id: "ok1" }, { id: "" }, { id: "ok2" }]);
  assert.deepEqual(archetypes.map((a) => a.id), ["ok1", "ok2"]);
  assert.equal(errors.length, 1);
});

test("duplicate ids: first wins", () => {
  const { archetypes, errors } = normalizeArchetypes([
    { id: "swe", label: "First" },
    { id: "SWE", label: "Second" },
  ]);
  assert.equal(archetypes.length, 1);
  assert.equal(archetypes[0].label, "First");
  assert.match(errors[0], /duplicate/i);
});

test("ids with path separators are rejected", () => {
  for (const id of ["../x", "a/b", "a\\b", ".", ".."]) {
    assert.equal(normalizeArchetypes([{ id }]).archetypes.length, 0, `should reject: ${id}`);
  }
});

// ── resolveArchetype ─────────────────────────────────────────────────────────

const REG = normalizeArchetypes([{ id: "swe" }, { id: "ai_engineer" }]).archetypes;

test("resolves a known id, case-insensitively", () => {
  assert.equal(resolveArchetype(REG, "ai_engineer")?.id, "ai_engineer");
  assert.equal(resolveArchetype(REG, "AI_ENGINEER")?.id, "ai_engineer");
});

test("an unknown or absent id resolves to null WITHOUT throwing", () => {
  // Unlike a root, an unknown archetype touches no filesystem: it simply selects
  // no overlay. Erroring here would break a page for a cosmetic mismatch.
  assert.equal(resolveArchetype(REG, "nope"), null);
  assert.equal(resolveArchetype(REG, null), null);
  assert.equal(resolveArchetype(REG, ""), null);
  assert.equal(resolveArchetype([], "swe"), null);
});

// ── archetypeNoteSegment ─────────────────────────────────────────────────────

test("produces a TAGGED segment matching the via= convention, not prose", () => {
  assert.equal(archetypeNoteSegment("ai_engineer"), "archetype=ai_engineer");
});

test("no archetype produces no segment", () => {
  assert.equal(archetypeNoteSegment(null), "");
  assert.equal(archetypeNoteSegment(""), "");
});

test("a malformed id never reaches the tracker", () => {
  // The Notes column is free text; an id containing a pipe or newline would
  // corrupt the markdown table it lands in.
  for (const bad of ["a|b", "a\nb", "../x", "with space"]) {
    assert.equal(archetypeNoteSegment(bad), "", `should refuse: ${JSON.stringify(bad)}`);
  }
});
