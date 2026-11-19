import { BodySection, Skeleton } from "../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";
import { RUNS_CHART_HEIGHT } from "./analytics-model.js";

/** Same sections and heights as the loaded page, so content does not jump when the report arrives. */
export function ActivitySkeleton() {
  return <LoadingRegion label="Loading analytics report">
    <div className="ds-body-stack mt-2">
      <BodySection title="Runs" description={<SkeletonText className="w-40" />}>
        <div className="rounded-[var(--ds-row-radius)] border border-ui-stroke bg-[var(--ds-card-bg)] px-[var(--ds-row-pad-x)] py-4"><div style={{ height: RUNS_CHART_HEIGHT }}><Skeleton className="size-full rounded-sm" /></div></div>
      </BodySection>
      <BodySection title="Workflows" description={<SkeletonText className="w-56" />}>
        <div className="rounded-[var(--ds-row-radius)] border border-ui-stroke">{[0, 1, 2].map(row => <div key={row} className="border-b border-ui-stroke px-4 py-3 last:border-b-0"><SkeletonText className="w-3/5" /></div>)}</div>
      </BodySection>
    </div>
  </LoadingRegion>;
}
