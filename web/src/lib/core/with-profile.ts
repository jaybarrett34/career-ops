import { cookies } from "next/headers";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { withProfile, type ActiveProfileShape } from "@/lib/core/active-profile-types";
import { normalizeRoots, checkRoot, resolveActiveRoot } from "@/lib/core/roots.mjs";
import { defaultCareerOpsRoot } from "@/lib/career-ops";

/**
 * Entry-point wrappers that establish the per-request profile scope.
 *
 * Every page and route handler that can reach careerOpsRoot() wraps itself with
 * one of these. The spike behind this design (see active-root.mjs) established
 * that there is no single global place to do it: a root layout's async context
 * does not reach child pages, and middleware completes before the handler runs.
 *
 * COOKIE CARRIES AN ID, NEVER A PATH. resolveActiveRoot() only ever compares the
 * cookie value against ids already in the registry and never uses it to build a
 * path, so a forged cookie cannot widen the set of readable directories. It also
 * falls back rather than throwing, so a cookie naming a root that was since
 * removed degrades to the default instead of bricking every page.
 */

const ROOT_COOKIE = "career-ops-root";
const ARCHETYPE_COOKIE = "career-ops-archetype";

/** Read config/roots.yml from the INSTALL, not from whichever profile is active. */
function readRegistry(): ReturnType<typeof normalizeRoots> {
  const file = path.join(defaultCareerOpsRoot(), "config", "roots.yml");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { roots: [], errors: [] }; // absent registry is the normal single-person case
  }
  try {
    return normalizeRoots(yaml.load(raw));
  } catch (e) {
    // A malformed registry must never be overwritten or silently emptied; report
    // and fall back, matching the data-loss guard in api/profile/route.ts.
    return { roots: [], errors: [`config/roots.yml is not valid YAML: ${e instanceof Error ? e.message : e}`] };
  }
}

const fsQueries = {
  exists: (p: string) => fs.existsSync(p),
  isDir: (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  resolve: (...a: string[]) => path.resolve(...a),
};

/** Resolve the active profile for THIS request from its cookies. */
export async function resolveProfileFromRequest(): Promise<ActiveProfileShape> {
  const jar = await cookies();
  const { roots } = readRegistry();
  const requested = jar.get(ROOT_COOKIE)?.value ?? null;

  const resolved = resolveActiveRoot(
    roots,
    requested,
    defaultCareerOpsRoot(),
    (r) => checkRoot(r, fsQueries),
    (...a: string[]) => path.resolve(...a),
  );

  return {
    root: resolved.path,
    rootId: resolved.id,
    // Layer 2 is an id only; resolving what it means is the archetype overlay's
    // job, and it is deliberately not validated here so a bad value cannot stop
    // a page from rendering its (correct) root.
    archetypeId: jar.get(ARCHETYPE_COOKIE)?.value ?? null,
  };
}

/**
 * Wrap a route handler. Usage:
 *   export const GET = withActiveProfile(async (req) => { ... });
 */
export function withActiveProfile<A extends unknown[], R>(
  handler: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const profile = await resolveProfileFromRequest();
    return withProfile(profile, () => handler(...args));
  };
}

/**
 * Wrap a page component. Same mechanism; separate name so the coverage test's
 * intent reads clearly at each call site.
 */
export const withActiveProfilePage = withActiveProfile;
