"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Download, Trash2, FileText, Loader2, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/core/files.mjs";

type Row = { name: string; bytes: number; modified: string; root: "documents" | "output" };
type Payload = { files: Row[]; allowedExtensions: string[]; maxBytes: number };

export function FilesView() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetch("/api/files").then((r) => r.json()));
    } catch {
      setError("Could not read the file list.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    for (const f of Array.from(files)) {
      const body = new FormData();
      body.append("file", f);
      try {
        const res = await fetch("/api/files", { method: "POST", body });
        const j = await res.json().catch(() => ({}));
        // Name the file that failed. "Upload failed" across a multi-file drop
        // leaves the user guessing which one.
        if (!res.ok) setError(`${f.name}: ${j.error ?? res.status}`);
      } catch {
        setError(`${f.name}: upload failed`);
      }
    }
    await load();
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(name: string) {
    setBusy(true);
    await fetch(`/api/files?name=${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
    await load();
    setBusy(false);
  }

  const docs = data?.files.filter((f) => f.root === "documents") ?? [];
  const out = data?.files.filter((f) => f.root === "output") ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-brand bg-brand-soft" : "border-border bg-surface/40",
        )}
      >
        {busy ? <Loader2 className="size-6 animate-spin text-muted" /> : <Upload className="size-6 text-muted" />}
        <div className="text-sm">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-brand-text underline underline-offset-4"
          >
            Choose files
          </button>{" "}
          <span className="text-muted">or drop them here</span>
        </div>
        <p className="text-xs text-faint">
          {data ? `${data.allowedExtensions.join(", ")} · up to ${Math.round(data.maxBytes / 1048576)} MB` : " "}
        </p>
        <input
          ref={inputRef}
          id="file-upload"
          type="file"
          multiple
          className="hidden"
          accept={data?.allowedExtensions.join(",")}
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-500">{error}</p>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Export</h2>
          <span className="text-xs text-faint">Your data, in a format nothing here controls.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { kind: "tracker", label: "Tracker (CSV)" },
            { kind: "pipeline", label: "Pipeline (CSV)" },
            { kind: "all", label: "Everything (JSON)" },
          ].map((x) => (
            <a
              key={x.kind}
              href={`/api/export?kind=${x.kind}`}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface/50 px-3 py-2 text-sm transition-colors hover:bg-surface-hover"
            >
              <Table2 className="size-3.5 text-muted" />
              {x.label}
            </a>
          ))}
        </div>
      </section>

      <Group title="Documents" hint="Read by intake. Yours to add and remove." rows={docs} onDelete={remove} busy={busy} />
      <Group title="Output" hint="Generated CVs and PDFs. Download only." rows={out} busy={busy} />
    </div>
  );
}

function Group({
  title, hint, rows, onDelete, busy,
}: {
  title: string; hint: string; rows: Row[];
  onDelete?: (name: string) => void; busy: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <span className="text-xs text-faint">{hint}</span>
        <span className="ml-auto text-xs tabular-nums text-faint">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-border bg-surface/40 px-3 py-4 text-sm text-muted">
          Nothing here yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((f) => (
            <li key={`${f.root}/${f.name}`} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-faint">{formatBytes(f.bytes)}</span>
              <a
                href={`/api/files?root=${f.root}&name=${encodeURIComponent(f.name)}`}
                download={f.name}
                aria-label={`Download ${f.name}`}
                className="shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <Download className="size-4" />
              </a>
              {onDelete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(f.name)}
                  aria-label={`Delete ${f.name}`}
                  className="shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
