// Typed re-export of the .mjs store. The store itself is plain .mjs so Node's
// test runner can import it without a loader; this file gives the TypeScript
// call sites real types without duplicating the implementation.
import {
  withProfile as _withProfile,
  activeProfile as _activeProfile,
  activeRoot as _activeRoot,
  activeArchetypeId as _activeArchetypeId,
} from "@/lib/core/active-root.mjs";

export type ArchetypeShape = {
  id: string;
  label: string;
  tex: string | null;
  keywords: string[];
  model: string | null;
};

export type ActiveProfileShape = {
  root: string;
  rootId: string | null;
  archetypeId: string | null;
  /** The resolved overlay, or null when no archetype is active or the id is unknown. */
  archetype: ArchetypeShape | null;
};

export const withProfile = _withProfile as <T>(p: ActiveProfileShape, fn: () => T) => T;
export const activeProfile = _activeProfile as () => ActiveProfileShape | null;
export const activeRoot = _activeRoot as () => string | null;
export const activeArchetypeId = _activeArchetypeId as () => string | null;

/** The resolved active archetype, or null. Layer 2; independent of the root. */
export function activeArchetype(): ArchetypeShape | null {
  return activeProfile()?.archetype ?? null;
}
