import { FilesView } from "@/components/files-view";
import { withActiveProfile } from "@/lib/core/with-profile";

export const dynamic = "force-dynamic";

async function FilesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="mt-1.5 max-w-prose text-sm text-muted">
          Drop a master CV, a job description or a transcript into Documents and the{" "}
          <span className="text-foreground">intake</span> mode can read it. Generated CVs and
          PDFs appear under Output. Both are scoped to the active profile.
        </p>
      </header>
      <FilesView />
    </main>
  );
}

export default withActiveProfile(FilesPage);
