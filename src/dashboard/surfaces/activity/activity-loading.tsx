import { BodySection, Skeleton, dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";
import { RUNS_CHART_HEIGHT } from "./analytics-model.js";

/** The report while it loads: only the Runs card, whose size never depends on the report (period row, plot, axis gap,
 * three key figures). Workflows, Time, Messages and Actions depend on the period's data, so no guessed frame stands in for them. */
export function ActivitySkeleton() {
  return <LoadingRegion label="Loading analytics report">
    <div className="ds-body-stack mt-2">
      <BodySection title="Runs" description={<SkeletonText className="w-40" />}>
        <div className="min-w-0 rounded-[var(--ds-row-radius)] border border-ui-stroke bg-[var(--ds-card-bg)] px-[var(--ds-row-pad-x)] py-4">
          <div className="mb-4 flex items-center justify-between gap-3"><SkeletonText className="w-40 text-control" /><span className="flex items-center gap-1"><Skeleton className="size-6" /><Skeleton className="size-6" /></span></div>
          <div className="ml-9" style={{ height: RUNS_CHART_HEIGHT }}><Skeleton className="size-full rounded-sm" /></div>
          <div className="h-6" />
          <ul className="m-0 mt-4 flex list-none gap-3 p-0">{[0, 1, 2].map(item => <li key={item} className="flex min-w-0 flex-1 flex-col">
            <SkeletonText className="w-20 text-body" /><SkeletonText className={cn(dsText.title, "w-24")} />
          </li>)}</ul>
        </div>
      </BodySection>
    </div>
  </LoadingRegion>;
}
