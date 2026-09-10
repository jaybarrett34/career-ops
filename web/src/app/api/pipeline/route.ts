import { pipelineSummary } from "@/lib/career-ops";
import { withActiveProfile } from "@/lib/core/with-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read fresh local files

// Exposes the user's pipeline (inbox + tracker) to the client so the assistant
// can resolve "all the Anthropic ones" to concrete postings CLIENT-SIDE — the
// model only ever emits a company name, never URLs (no hallucination, no tokens).
async function handleGET() {
  const s = pipelineSummary();
  return Response.json({
    inbox: s.inbox,
    applications: s.applications,
    root: s.root,
    rootExists: s.rootExists,
  });
}

// Establishes the per-request profile scope; see lib/core/with-profile.ts.
export const GET = withActiveProfile(handleGET);
