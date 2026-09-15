import { FileStack } from "lucide-react";
import { ResumesView } from "@/components/resumes-view";
import { withActiveProfilePage } from "@/lib/core/with-profile";

export const dynamic = "force-dynamic";

function ResumesPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <FileStack className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Resumes</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Every resume in <code className="text-foreground">config/resumes.yml</code>, where its template and built PDF sit
        on disk, and whether the PDF still matches what it was built from.
      </p>
      <p className="mt-1.5 text-xs text-faint">
        A PDF goes stale when the template, the bullet library, or its own bullet selection changes underneath it —
        which is easy to miss, because the file on disk looks fine.
      </p>
      <div className="mt-6">
        <ResumesView />
      </div>
    </div>
  );
}

export default withActiveProfilePage(ResumesPage);
