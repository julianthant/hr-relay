import { BodySection, Skeleton, dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";
import { RUNS_CHART_HEIGHT } from "./analytics-model.js";

/** Same sections and heights as the loaded page, so content does not jump when the report arrives: the Runs card
 * keeps its period row, plot, axis gap and three key figures, and Workflows is the loaded table with its own rows.
 * Messages and Actions hold the one line they show for a period without any. */
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
      <BodySection title="Workflows" description="Open a row to see what went wrong.">
        <div className="ds-table-list-frame ds-usage-table"><table className="table-fixed">
          <colgroup><col className="w-10" /><col /><col className="w-[114px]" /><col className="w-[114px]" /><col className="w-[122px]" /><col className="w-[186px]" /></colgroup>
          <thead><tr><th className="ds-usage-chevron" /><th className="!pl-0">Workflow</th>{["Runs", "Done", "Failed", "Typical time"].map(head => <th key={head} className="text-right">{head}</th>)}</tr></thead>
          <tbody>{[0, 1, 2].map(row => <tr key={row}><td className="ds-usage-chevron"><Skeleton className="size-5" /></td><td className="!pl-0"><SkeletonText className="w-40" /></td>
            {[0, 1, 2, 3].map(cell => <td key={cell}><SkeletonText className="ml-auto w-10" /></td>)}</tr>)}</tbody>
        </table></div>
      </BodySection>
      <BodySection title="Messages" description="Messages sent to the assistant each day."><SkeletonText className="w-48 text-body" /></BodySection>
      <BodySection title="Actions" description="Actions the assistant proposed each day."><SkeletonText className="w-56 text-body" /></BodySection>
    </div>
  </LoadingRegion>;
}
