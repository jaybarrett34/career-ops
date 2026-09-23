"use client";

import { useEffect, useState } from "react";
import { Loader2, FileText, Eye, Download, AlertTriangle, Copy, Check, X } from "lucide-react";
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

      {open && row.pdfPath && <PreviewFrame id={row.id} onClose={onToggle} />}
    </div>
  );
}

/**
 * The preview.
 *
 * A US Letter page is 8.5x11 — TALLER than almost any laptop viewport once the
 * card, the nav and the browser chrome are accounted for. Rendering it inline
 * inside a card meant the page was always scaled down to something you could
 * not read, on exactly the machines this runs on. So it pops out: a modal that
 * takes the viewport, sized by ASPECT RATIO rather than a fixed height, so the
 * whole page fits whatever the screen is without ever being cropped.
 *
 * Below `sm` there is no room for a letter page beside anything, so the modal
 * goes full-bleed and the frame simply fills it.
 */
function PreviewFrame({ id, onClose }: { id: string; onClose: () => void }) {
  const src = `/api/resumes?id=${encodeURIComponent(id)}&file=pdf`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-viewport overlay is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${id} preview`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-full w-full flex-col overflow-hidden rounded-xl bg-surface shadow-2xl sm:w-auto"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
          <FileText className="size-4 shrink-0 text-brand" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{id}</p>
          <a
            href={src}
            download={`${id}.pdf`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand"
          >
            <Download className="size-3" /> PDF
          </a>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Sizing lives in `style`, not a Tailwind class. An arbitrary value
            holding a calc() with spaces and nested parens does not survive
            Tailwind's class parser -- it was dropped, the width collapsed, and
            the modal rendered as a sliver with a blank frame. Plain CSS has no
            such constraint.

            The pair keeps a US Letter page (8.5x11, ratio 0.7727) fully visible:
            width follows the available height, height follows the available
            width, and whichever is scarcer wins. */}
        <object
          data={src}
          type="application/pdf"
          className="max-w-full bg-white"
          style={{
            width: "min(92vw, calc((100vh - 9rem) * 0.7727))",
            height: "min(calc(100vh - 9rem), calc(92vw * 1.294))",
          }}
        >
          <p className="p-6 text-sm text-muted">
            This browser will not preview PDFs inline.{" "}
            <a className="text-brand underline" href={src}>Open it in a new tab</a>.
          </p>
        </object>
      </div>
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
