import { assembleDedupContext } from "@/lib/core/discover";
import { withActiveProfile } from "@/lib/core/with-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The client fetches this once before opening the AI stream and uses the set as a
// silent dedup backstop in the envelope parser (drops any AI candidate whose URL
// is already known). Keeps the stream itself pure text/plain.
async function handleGET() {
  try {
    const { urls } = assembleDedupContext();
    return Response.json({ urls: [...urls] });
  } catch {
    return Response.json({ urls: [] });
  }
}

// Establishes the per-request profile scope; see lib/core/with-profile.ts.
export const GET = withActiveProfile(handleGET);
