import { readApplications, readInbox } from "@/lib/career-ops";
import { withActiveProfile } from "@/lib/core/with-profile";
import { activeProfile } from "@/lib/core/active-profile-types";
import { toCsv, exportFilename, TRACKER_COLUMNS, PIPELINE_COLUMNS } from "@/lib/core/export.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Export the ACTIVE profile's own data as CSV or a JSON bundle. Read-only:
// nothing here writes, so an export can never damage what it is exporting.

const KINDS = ["tracker", "pipeline", "all"] as const;
type Kind = (typeof KINDS)[number];

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "tracker") as Kind;
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  if (!KINDS.includes(kind)) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const prof = activeProfile();

  let body: string;
  let ext: string;
  if (format === "json" || kind === "all") {
    // The bundle records WHICH profile produced it. An export that does not say
    // whose data it holds is a hazard the moment two of them sit in Downloads.
    body = JSON.stringify({
      exportedAt: new Date().toISOString(),
      profile: { rootId: prof?.rootId ?? null, archetypeId: prof?.archetypeId ?? null },
      tracker: readApplications(),
      pipeline: readInbox(),
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
