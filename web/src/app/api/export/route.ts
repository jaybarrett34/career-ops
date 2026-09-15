import { readApplications, readInbox } from "@/lib/career-ops";
import { withActiveProfile } from "@/lib/core/with-profile";
import { activeProfile } from "@/lib/core/active-profile-types";
import { toCsv, exportFilename, TRACKER_COLUMNS, PIPELINE_COLUMNS } from "@/lib/core/export.mjs";
import { buildXlsx } from "@/lib/core/xlsx.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Export the ACTIVE profile's own data as CSV or a JSON bundle. Read-only:
// nothing here writes, so an export can never damage what it is exporting.

const KINDS = ["tracker", "pipeline", "all"] as const;
type Kind = (typeof KINDS)[number];

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "tracker") as Kind;
  const fmt = url.searchParams.get("format");
  const format = fmt === "json" ? "json" : fmt === "xlsx" ? "xlsx" : "csv";
  if (!KINDS.includes(kind)) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const prof = activeProfile();

  // `kind` selects the contents in EVERY format. It used to apply only to CSV
  // while json and xlsx always emitted both datasets -- but the filename is
  // built from `kind` either way, so asking for the tracker downloaded
  // "career-ops-tracker-<date>.xlsx" holding thousands of pipeline rows. A file
  // whose name misdescribes its contents is worse than one that is simply large.
  const wantTracker = kind === "tracker" || kind === "all";
  const wantPipeline = kind === "pipeline" || kind === "all";

  if (format === "xlsx") {
    const rows = (cols: readonly { key: string; label: string }[], data: Record<string, unknown>[]) =>
      [cols.map((c) => c.label), ...data.map((d) => cols.map((c) => (d[c.key] ?? "") as string))];
    const sheets = [];
    if (wantTracker) sheets.push({ name: "Tracker", rows: rows(TRACKER_COLUMNS, readApplications() as unknown as Record<string, unknown>[]) });
    if (wantPipeline) sheets.push({ name: "Pipeline", rows: rows(PIPELINE_COLUMNS, readInbox() as unknown as Record<string, unknown>[]) });
    const buf = buildXlsx(sheets);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${exportFilename(kind, "xlsx", today)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  let body: string;
  let ext: string;
  if (format === "json" || kind === "all") {
    // The bundle records WHICH profile produced it. An export that does not say
    // whose data it holds is a hazard the moment two of them sit in Downloads.
    body = JSON.stringify({
      exportedAt: new Date().toISOString(),
      profile: { rootId: prof?.rootId ?? null, archetypeId: prof?.archetypeId ?? null },
      kind,
      ...(wantTracker ? { tracker: readApplications() } : {}),
      ...(wantPipeline ? { pipeline: readInbox() } : {}),
    }, null, 2);
    ext = "json";
  } else if (kind === "tracker") {
    body = toCsv(readApplications(), TRACKER_COLUMNS);
    ext = "csv";
  } else {
    body = toCsv(readInbox(), PIPELINE_COLUMNS);
    ext = "csv";
  }

  return new Response(body, {
    headers: {
      "Content-Type": ext === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(kind, ext, today)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withActiveProfile(handleGET);
