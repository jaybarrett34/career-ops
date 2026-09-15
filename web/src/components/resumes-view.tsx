"use client";

import { useEffect, useState } from "react";
import { Loader2, FileText, Eye, Download, AlertTriangle, Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";

type Row = {
  id: string;
  foundational: boolean;
  tailoredFrom: string | null;
  bullets: number;
  templatePath: string | null;
  templateExists: boolean;
  templateModified: string | null;
  pdfPath: string | null;
  pdfBytes: number | null;
  pdfModified: string | null;
  stale: boolean;
  reason: string | null;
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function ResumesView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [root, setRoot] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/resumes")
      .then((r) => r.json())
      .then((d) => { setRows(d.resumes ?? []); setRoot(d.root ?? ""); })
      .catch(() => setRows([]));
  }, []);

  if (rows === null) {
    return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Reading config/resumes.yml…</p>;
  }
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
        No resumes in <code className="text-foreground">config/resumes.yml</code> yet.
      </p>
    );
  }

  const base = rows.filter((r) => r.foundational);
  const tailored = rows.filter((r) => !r.foundational);

  return (
    <div className="space-y-8">
      <Group
        title="Foundational"
        blurb="The archetypes you maintain by hand. Everything else is derived from these."
        rows={base} root={root} open={open} setOpen={setOpen}
      />
      {tailored.length > 0 && (
        <Group
          title="Tailored for a listing"
          blurb="Produced by the tailor from a foundational archetype. Safe to delete; they rebuild."
          rows={tailored} root={root} open={open} setOpen={setOpen}
        />
      )}
    </div>
  );
}

function Group({ title, blurb, rows, root, open, setOpen }: {
  title: string; blurb: string; rows: Row[]; root: string;
  open: string | null; setOpen: (v: string | null) => void;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold tracking-wide text-landing uppercase">{title} <span className="tabular-nums text-faint">{rows.length}</span></h2>
      <p className="mt-1 text-xs text-faint">{blurb}</p>
      <div className="mt-4 space-y-3">
        {rows.map((r) => <Card key={r.id} row={r} root={root} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />)}
      </div>
    </section>
  );
}

function Card({ row, root, open, onToggle }: { row: Row; root: string; open: boolean; onToggle: () => void }) {
  const rel = (p: string | null) => (p && root && p.startsWith(root) ? p.slice(root.length + 1) : p ?? "—");
  return (
    <div className={cn("rounded-2xl border bg-surface/40 p-4 transition-colors", row.stale ? "border-amber-500/40" : "border-border")}>
      <div className="flex flex-wrap items-start gap-3">
        <FileText className="mt-0.5 size-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{row.id}</p>
          <p className="mt-0.5 text-xs text-muted">
            {row.bullets} bullets · PDF built {when(row.pdfModified)}
            {row.pdfBytes ? ` · ${Math.round(row.pdfBytes / 1024)} KB` : ""}
          </p>
          {row.stale && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3" />
              {row.reason} — recompose before sending
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {row.pdfPath && (
            <>
              <Btn onClick={onToggle} icon={<Eye className="size-3" />} label={open ? "Hide" : "Quick look"} />
              <a
                href={`/api/resumes?id=${encodeURIComponent(row.id)}&file=pdf`}
                download={`${row.id}.pdf`}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[36px]"
              >
                <Download className="size-3" /> PDF
              </a>
            </>
          )}
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
        <PathRow label="template" path={rel(row.templatePath)} full={row.templatePath} missing={!row.templateExists} />
        <PathRow label="built PDF" path={rel(row.pdfPath)} full={row.pdfPath} missing={!row.pdfPath} />
      </dl>

      {open && row.pdfPath && (
        <object
          data={`/api/resumes?id=${encodeURIComponent(row.id)}&file=pdf`}
          type="application/pdf"
          className="mt-3 h-[70vh] w-full rounded-lg border border-border bg-white"
        >
          <p className="p-4 text-sm text-muted">
            This browser will not preview PDFs inline.{" "}
            <a className="text-brand underline" href={`/api/resumes?id=${encodeURIComponent(row.id)}&file=pdf`}>Open it instead</a>.
          </p>
        </object>
      )}
    </div>
  );
}

function PathRow({ label, path, full, missing }: { label: string; path: string; full: string | null; missing: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-faint">{label}</dt>
      <dd className={cn("min-w-0 flex-1 truncate font-mono", missing ? "text-red-500" : "text-muted")} title={full ?? undefined}>
        {missing ? `${path} (not built)` : path}
      </dd>
      {full && (
        <button
          onClick={() => {
            // The full absolute path is what you paste into a terminal or a
            // file-open dialog; the row shows it relative to keep the card readable.
            navigator.clipboard?.writeText(full).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }).catch(() => { /* clipboard blocked; the title attribute still shows it */ });
          }}
          title="Copy the absolute path"
          className="shrink-0 text-faint transition-colors hover:text-brand"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      )}
    </div>
  );
}

function Btn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[36px]"
    >
      {icon} {label}
    </button>
  );
}
