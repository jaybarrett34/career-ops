"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Check, AlertTriangle, ChevronDown, Layers } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Layer 1 switcher: which PERSON's data this install is acting on.
 *
 * Hides itself entirely when config/roots.yml is absent, which is the normal
 * single-person case — the app then behaves exactly as it did before this
 * feature existed.
 *
 * Motion is hand-written CSS transitions rather than an animation library. The
 * open/close is a two-property transition; pulling in GSAP or Framer Motion to
 * express that would be ~50KB for one menu.
 */

type Root = {
  id: string;
  label: string;
  enabled: boolean;
  usable: boolean;
  reason: string | null;
  active: boolean;
};

type Archetype = {
  id: string;
  label: string;
  hasTex: boolean;
  keywordCount: number;
  active: boolean;
};

type Payload = {
  configured: boolean;
  activeId: string | null;
  activeArchetypeId: string | null;
  roots: Root[];
  archetypes: Archetype[];
  errors: string[];
};

export function ProfileSwitcher() {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, []);

  // Close on outside click and on Escape — a menu that traps focus in a
  // single-operator tool is pure friction.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Each layer hides independently: a single-person install with archetypes
  // still gets the archetype picker, and vice versa.
  if (!data) return null;
  const showRoots = data.configured;
  const showArchetypes = (data.archetypes?.length ?? 0) > 0;
  if (!showRoots && !showArchetypes) return null;

  const active = data.roots.find((r) => r.active);
  const label = active?.label ?? "Default";

  async function select(patch: { rootId?: string | null; archetypeId?: string | null }) {
    setBusy((patch.rootId ?? patch.archetypeId ?? "__default__") as string);
    setError(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `switch failed (${res.status})`);
        return;
      }
      setOpen(false);
      // Every server component re-renders against the new root. A full refresh
      // rather than local state: the whole page is now a different person's
      // data, and leaving any of it stale is the failure this feature exists to
      // prevent.
      router.refresh();
      const fresh = await fetch("/api/profiles").then((r) => r.json());
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "switch failed");
    } finally {
      setBusy(null);
    }
  }

  const activeArchetype = data.archetypes?.find((a) => a.active);

  return (
    <div ref={boxRef} className="relative px-1">
      {showRoots && (
      <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface/50 px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-hover"
      >
        <Users className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      <div
        role="listbox"
        className={cn(
          "absolute bottom-full left-1 right-1 z-20 mb-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg",
          // Hand-rolled open/close: opacity + translate, with the collapsed
          // state made non-interactive so it cannot swallow clicks.
          "origin-bottom transition-all duration-150 ease-out motion-reduce:transition-none",
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
        )}
      >
        {data.roots.map((r) => (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={r.active}
            disabled={!r.usable || busy !== null}
            title={r.reason ?? undefined}
            onClick={() => select({ rootId: r.id })}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors",
              r.usable ? "hover:bg-surface-hover" : "cursor-not-allowed opacity-50",
              r.active && "text-brand-text",
            )}
          >
            {r.active ? (
              <Check className="size-3.5 shrink-0" />
            ) : !r.usable ? (
              <AlertTriangle className="size-3.5 shrink-0 text-muted" />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {busy === r.id && <span className="text-[10px] text-muted">…</span>}
          </button>
        ))}

        {data.activeId && (
          <button
            type="button"
            onClick={() => select({ rootId: null })}
            disabled={busy !== null}
            className="flex w-full items-center gap-2 border-t border-border px-2.5 py-2 text-left text-xs text-muted transition-colors hover:bg-surface-hover"
          >
            <span className="size-3.5 shrink-0" />
            Use this install&rsquo;s own data
          </button>
        )}
      </div>

      </>
      )}

      {showArchetypes && (
        <div className={cn("relative", showRoots && "mt-1.5")}>
          <label className="sr-only" htmlFor="archetype-select">CV archetype</label>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface/50 px-2.5 py-2">
            <Layers className="size-3.5 shrink-0 text-muted" />
            {/* A native select, deliberately: layer 2 is a plain one-of-N choice
                with no per-option state to show, so a custom menu would be more
                code and less keyboard-accessible for no gain. */}
            <select
              id="archetype-select"
              value={activeArchetype?.id ?? ""}
              disabled={busy !== null}
              onChange={(e) => select({ archetypeId: e.target.value || null })}
              className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-sm text-foreground outline-none"
            >
              <option value="">No archetype</option>
              {data.archetypes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.hasTex ? "" : " (no CV source)"}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && <p className="mt-1 px-1 text-[11px] leading-snug text-red-500">{error}</p>}
      {data.errors.length > 0 && (
        <p className="mt-1 px-1 text-[11px] leading-snug text-amber-600" title={data.errors.join("\n")}>
          {data.errors.length} problem{data.errors.length > 1 ? "s" : ""} in config/roots.yml
        </p>
      )}
    </div>
  );
}
