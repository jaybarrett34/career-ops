import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { normalizeDiscovered, setLock, toYaml } from "@/lib/core/discovered.mjs";

/**
 * Read/write side of the dynamic-expansion ledger for the ACTIVE profile.
 *
 * The file lives under the active root, so each person accumulates their own
 * map of where roles come from and one person's decisions never reach another's
 * list. That separation is the reason the lock is stored here rather than in a
 * shared registry.
 */

export type DiscoveredRow = {
  id: string;
  company: string;
  hosts: string[];
  sources: string[];
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
  promoted: boolean;
  lock: "open" | "pinned" | "dismissed";
};

function file(): string {
  return path.join(careerOpsRoot(), "config", "discovered.yml");
}

function load(): Map<string, Omit<DiscoveredRow, "id">> {
  try {
    return normalizeDiscovered(yaml.load(fs.readFileSync(file(), "utf8")));
  } catch {
    // Absent is the normal state before the first scan; unparseable is reported
    // by readDiscovered rather than thrown, so one bad file cannot brick a page.
    return new Map();
  }
}

/** Every entry, pinned first, then by how often it has come up. */
export function readDiscovered(): { rows: DiscoveredRow[]; error: string | null } {
  let error: string | null = null;
  try {
    fs.readFileSync(file(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      error = e instanceof Error ? e.message : "could not read config/discovered.yml";
    }
  }
  const rank = (l: string) => (l === "pinned" ? 0 : l === "open" ? 1 : 2);
  const rows = [...load().entries()]
    .map(([id, e]) => ({ id, ...e }) as DiscoveredRow)
    .sort((a, b) => rank(a.lock) - rank(b.lock) || b.count - a.count || a.company.localeCompare(b.company));
  return { rows, error };
}

/**
 * Set one entry's lock. Returns false when no such entry exists.
 *
 * The id is the ledger's own company key, which is what keeps this from being a
 * way to CREATE an entry: an id that is not already in the file writes nothing.
 */
export function writeLock(id: string, lock: "open" | "pinned" | "dismissed"): boolean {
  const { map, found } = setLock(load(), id, lock);
  if (!found) return false;
  atomicWriteWithBackup(file(), toYaml(map));
  return true;
}
