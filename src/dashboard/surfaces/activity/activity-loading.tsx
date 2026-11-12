import { Skeleton } from "../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";

export function ActivitySkeleton() {
  return <LoadingRegion label="Loading analytics report">
    <div className="ds-body-stack mt-2">
      <section><h2 className="mb-1 mt-0 text-section">Runs</h2><div className="mt-4 rounded-[var(--ds-row-radius)] border border-ui-stroke px-[var(--ds-row-pad-x)] py-4"><Skeleton className="h-40 w-full rounded-sm" /></div></section>
      <section><h2 className="mb-1 mt-0 text-section">Workflows</h2><div className="mt-4 rounded-[var(--ds-row-radius)] border border-ui-stroke">{[0, 1, 2].map(row => <div key={row} className="border-b border-ui-stroke px-4 py-3 last:border-b-0"><SkeletonText className="w-3/5" /></div>)}</div></section>
    </div>
  </LoadingRegion>;
}
