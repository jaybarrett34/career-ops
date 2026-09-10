import { notFound } from "next/navigation";
import { readReport, findApplication, pdfReadyForReport, trackerCanDelete } from "@/lib/career-ops";
import { ReportView } from "@/components/report-view";
import { withActiveProfile } from "@/lib/core/with-profile";

export const dynamic = "force-dynamic";

async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();
  return (
    <ReportView
      id={id}
      app={app}
      report={report?.content ?? null}
      file={report?.file ?? null}
      canDelete={trackerCanDelete()}
      pdfReadyFromIndex={await pdfReadyForReport(id)}
    />
  );
}

// Establishes the per-request profile scope; see lib/core/with-profile.ts.
export default withActiveProfile(ReportPage);
