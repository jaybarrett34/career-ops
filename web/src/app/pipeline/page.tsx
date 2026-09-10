import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { PipelineView } from "@/components/pipeline-view";
import { withActiveProfile } from "@/lib/core/with-profile";

export const dynamic = "force-dynamic"; // always read fresh local files

function PipelinePage() {
  const { inbox, applications } = pipelineSummary();
  return (
    <Suspense>
      <PipelineView applications={applications} inbox={inbox} />
    </Suspense>
  );
}

// Establishes the per-request profile scope; see lib/core/with-profile.ts.
export default withActiveProfile(PipelinePage);
