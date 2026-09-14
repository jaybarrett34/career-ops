import { Telescope } from "lucide-react";
import { DiscoveredView } from "@/components/discovered-view";
import { withActiveProfilePage } from "@/lib/core/with-profile";

export const dynamic = "force-dynamic";

function DiscoveredPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Telescope className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Discovered</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Companies a scan surfaced that Portals does not track. Each one keeps a running count, so a company that posts
        one role a month for six months reads differently from one that dumped six in a single run.
      </p>
      <p className="mt-1.5 text-xs text-faint">
        Pin what is worth tracking, dismiss what is not. Both stick — a later scan keeps counting but never changes your
        decision. This list belongs to the active profile alone.
      </p>
      <div className="mt-6">
        <DiscoveredView />
      </div>
    </div>
  );
}

export default withActiveProfilePage(DiscoveredPage);
