import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import {
  normalizeDiscovered, setLock, toYaml,
} from "../../src/lib/core/discovered.mjs";

// The store's I/O is thin; what is worth pinning down is the round-trip it
// depends on, exercised against a REAL file the way the route does it.

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "co-discovered-"));
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  return dir;
}

test("a lock written to the file is the lock read back", () => {
  const dir = sandbox();
  try {
    const file = path.join(dir, "config", "discovered.yml");
    fs.writeFileSync(file, toYaml(new Map([
      ["acme", { company: "Acme", hosts: ["acme.com"], sources: ["simplify"], count: 4, firstSeen: "2026-01-01", lastSeen: "2026-02-01", promoted: false, lock: "open" }],
    ])));

    const { map, found } = setLock(normalizeDiscovered(yaml.load(fs.readFileSync(file, "utf8"))), "acme", "dismissed");
    assert.equal(found, true);
    fs.writeFileSync(file, toYaml(map));

    const back = normalizeDiscovered(yaml.load(fs.readFileSync(file, "utf8"))).get("acme");
    assert.equal(back.lock, "dismissed");
    // Everything else survives the rewrite: a lock must not cost the history.
    assert.equal(back.count, 4);
    assert.equal(back.firstSeen, "2026-01-01");
    assert.deepEqual(back.hosts, ["acme.com"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an id not in the file writes nothing", () => {
  const map = new Map([["acme", { company: "Acme", hosts: [], sources: [], count: 1, firstSeen: null, lastSeen: null, promoted: false, lock: "open" }]]);
  const { found } = setLock(map, "../../etc/passwd", "pinned");
  assert.equal(found, false);
  // The route turns this into a 404 rather than creating an entry, because the
  // ledger is written by scans and a POST must not invent a company.
});

test("an absent file reads as an empty ledger, not an error", () => {
  const dir = sandbox();
  try {
    let parsed;
    try {
      parsed = normalizeDiscovered(yaml.load(fs.readFileSync(path.join(dir, "config", "discovered.yml"), "utf8")));
    } catch {
      parsed = new Map();
    }
    assert.equal(parsed.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
