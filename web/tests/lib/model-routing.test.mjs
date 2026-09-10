import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { claudeCliArgs, argValue } from "../../src/lib/claude-invocation.mjs";

const KINDS = ["pdf", "evaluate", "research"];

test("no model given: no --model flag at all (today's behavior, unchanged)", () => {
  for (const kind of KINDS) {
    for (const model of [undefined, null, "", "   "]) {
      const args = claudeCliArgs({ kind, prompt: "x", model });
      assert.ok(!args.includes("--model"), `${kind} added --model for ${JSON.stringify(model)}`);
    }
  }
});

test("a model is passed through verbatim", () => {
  const args = claudeCliArgs({ kind: "pdf", prompt: "x", model: "some-opaque-model-id" });
  assert.equal(argValue(args, "--model"), "some-opaque-model-id");
});

test("surrounding whitespace is trimmed, so a stray newline in YAML cannot break the invocation", () => {
  const args = claudeCliArgs({ kind: "pdf", prompt: "x", model: "  spaced-id\n" });
  assert.equal(argValue(args, "--model"), "spaced-id");
});

test("--model does NOT widen the permission scope", () => {
  // The whole safety argument for reusing the audited Claude path rather than
  // adding a new KNOWN CLI entry is that permissions ride on `kind`, never on
  // the model. If a model could change the tool scope, that argument collapses.
  for (const kind of KINDS) {
    const without = claudeCliArgs({ kind, prompt: "x" });
    const with_ = claudeCliArgs({ kind, prompt: "x", model: "anything" });
    assert.equal(argValue(with_, "--allowedTools"), argValue(without, "--allowedTools"), kind);
    assert.equal(argValue(with_, "--disallowedTools"), argValue(without, "--disallowedTools"), kind);
  }
});

test("pdf keeps its write-scope freeze with a model set (#2185)", () => {
  const args = claudeCliArgs({ kind: "pdf", prompt: "x", model: "anything" });
  const denied = argValue(args, "--disallowedTools") ?? "";
  for (const tool of ["Write", "Edit", "Bash"]) {
    assert.match(denied, new RegExp(`\\b${tool}\\b`), `pdf must still deny ${tool}`);
  }
});

test("NO model name is hardcoded anywhere in web/src (modes/_shared.md owns that list)", () => {
  // The tier table in modes/_shared.md is documented as "the only place
  // model/provider names appear". A name creeping into web/ means two sources
  // of truth, and the one here would be the one nobody updates.
  const SRC = path.resolve(import.meta.dirname, "../../src");
  const NAMES = /\b(claude-(opus|sonnet|haiku|fable)|gpt-[0-9]|gemini-[0-9]|o[1-4]-(mini|preview)|llama-[0-9])/i;
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(p)) {
        const m = fs.readFileSync(p, "utf8").match(NAMES);
        if (m) offenders.push(`${path.relative(SRC, p)}: ${m[0]}`);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], `model names hardcoded in web/src:\n  ${offenders.join("\n  ")}`);
});
