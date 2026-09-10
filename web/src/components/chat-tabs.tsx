"use client";

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type SessionMeta = {
  id: string;
  title: string;
  rootId: string | null;
  archetypeId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

/**
 * The tab strip. Sessions are already scoped to the active profile by the API,
 * so everything shown here belongs to the person currently selected.
 *
 * Presentational on purpose: it owns no persistence and no fetching, so the
 * console remains the single place that decides when a transcript is written.
 * Two sources of save logic is how a tab ends up silently not persisting.
 */
export function ChatTabs({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  busy,
}: {
  sessions: SessionMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  busy?: boolean;
}) {
  // One unsaved conversation is the normal state, not something worth a tab
  // strip of its own — showing a single tab above every chat is pure chrome.
  if (sessions.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
      {sessions.map((s) => {
        const active = s.id === activeId;
        return (
          <div
            key={s.id}
            className={cn(
              "group flex max-w-[160px] shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
              active
                ? "border-brand/40 bg-brand-soft text-brand-text"
                : "border-transparent text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              disabled={busy}
              title={
                // The binding is worth surfacing: two tabs can look alike and
                // act on different people.
                [s.title, s.rootId && `person: ${s.rootId}`, s.archetypeId && `archetype: ${s.archetypeId}`]
                  .filter(Boolean)
                  .join(" · ")
              }
              className="min-w-0 flex-1 truncate text-left"
            >
              {s.title}
            </button>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              disabled={busy}
              aria-label={`Delete chat: ${s.title}`}
              className="shrink-0 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        disabled={busy}
        aria-label="New chat"
        title="New chat"
        className="ml-auto shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
