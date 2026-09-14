"use client";

import { useEffect, useState } from "react";
import { Loader2, Pin, PinOff, EyeOff, Undo2, Sparkles } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";

type Lock = "open" | "pinned" | "dismissed";
type Row = {
  id: string;
  company: string;
  hosts: string[];
  sources: string[];
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
  promoted: boolean;
  lock: Lock;
};

const TAB: { key: Lock | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pinned", label: "Pinned" },
  { key: "open", label: "Undecided" },
  { key: "dismissed", label: "Dismissed" },
];

export function DiscoveredView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Lock | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/discovered")
      .then((r) => r.json())
      .then((d) => { setRows(d.discovered ?? []); setError(d.error ?? null); })
      .catch(() => { setRows([]); setError("could not reach the server"); });
  }, []);

  async function setLock(id: string, lock: Lock) {
    setBusy(id);
    try {
      const res = await fetch("/api/discovered", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, lock }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "could not save");
        return;
      }
      // Optimism would be wrong here: the write can lose to a scan running in
      // the same moment, and the board would then show a lock the file does not
      // have. Only reflect what came back 200.
      setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, lock } : r)));
      setError(null);
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) {
    return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Reading the ledger…</p>;
  }

  const counts = {
    all: rows.length,
    pinned: rows.filter((r) => r.lock === "pinned").length,
    open: rows.filter((r) => r.lock === "open").length,
    dismissed: rows.filter((r) => r.lock === "dismissed").length,
  };
  const shown = tab === "all" ? rows : rows.filter((r) => r.lock === tab);

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Nothing discovered yet. Run a scan — every company it surfaces that{" "}
          <code className="text-foreground">portals.yml</code> does not already track shows up here, with a running count
          of how often it has come back.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {TAB.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors max-sm:min-h-[36px]",
                  tab === t.key ? "bg-brand text-brand-foreground" : "bg-surface-hover text-muted hover:text-foreground",
                )}
              >
                {t.label} <span className="tabular-nums opacity-70">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((r) => (
              <Box key={r.id} row={r} busy={busy === r.id} onLock={(l) => setLock(r.id, l)} />
            ))}
          </div>
          {shown.length === 0 && <p className="mt-5 text-sm text-muted">Nothing in this group.</p>}
        </>
      )}
    </div>
  );
}

function Box({ row, busy, onLock }: { row: Row; busy: boolean; onLock: (l: Lock) => void }) {
  const dismissed = row.lock === "dismissed";
  return (
    <div
      className={cn(
        "relative rounded-2xl border p-4 transition-colors",
        row.lock === "pinned" ? "border-brand/40 bg-brand/5" : "border-border bg-surface/40",
        dismissed && "opacity-55",
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyLogo name={row.company} size={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={row.company}>{row.company}</p>
          <p className="truncate font-mono text-[11px] text-faint" title={row.hosts.join(" · ")}>
            {row.hosts[0] ?? "no host recorded"}
          </p>
        </div>
        {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" />}
      </div>

      <p className="mt-3 text-xs text-muted">
        <span className="tabular-nums font-medium text-foreground">{row.count}</span> posting{row.count === 1 ? "" : "s"}
        {row.firstSeen && row.lastSeen && row.firstSeen !== row.lastSeen && (
          <> · {row.firstSeen} → {row.lastSeen}</>
        )}
        {row.firstSeen && row.firstSeen === row.lastSeen && <> · {row.firstSeen}</>}
      </p>
      {row.promoted && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <Sparkles className="size-3" /> in portals.yml
        </p>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        {row.lock === "pinned" ? (
          <Action onClick={() => onLock("open")} disabled={busy} icon={<PinOff className="size-3" />} label="Unpin" />
        ) : (
          <Action onClick={() => onLock("pinned")} disabled={busy} icon={<Pin className="size-3" />} label="Pin" />
        )}
        {dismissed ? (
          <Action onClick={() => onLock("open")} disabled={busy} icon={<Undo2 className="size-3" />} label="Restore" />
        ) : (
          <Action onClick={() => onLock("dismissed")} disabled={busy} icon={<EyeOff className="size-3" />} label="Dismiss" />
        )}
      </div>
    </div>
  );
}

function Action({ onClick, disabled, icon, label }: { onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 max-sm:min-h-[36px]"
    >
      {icon} {label}
    </button>
  );
}
