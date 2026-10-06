import { Skeleton } from "../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../domain/dashboard/activity-volume.js";
import { activityVolumeTitle } from "./activity-chart-model.js";
import type { ActivityDateRange } from "./activity-model.js";
import { ActivityDurationsSkeleton } from "./activity-duration.js";

function TableSkeleton({ title, columns = 2, rows = 2, notes = false }: { title: string; columns?: number; rows?: number; notes?: boolean }) {
  return <section><h2 className="mb-3 mt-0 text-section">{title}</h2><div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-panel">
    <table aria-hidden className="w-full table-fixed border-collapse text-body"><colgroup><col className="w-[30%]" />{Array.from({ length: columns - 1 }, (_, index) => <col key={index} />)}</colgroup>
      {columns > 2 && <thead className="bg-ui-table text-caption"><tr>{Array.from({ length: columns }, (_, index) => <td key={index} className="px-4 py-3"><SkeletonText className="w-3/4" /></td>)}</tr></thead>}
      <tbody>{Array.from({ length: rows }, (_, row) => <tr key={row} className="border-b border-ui-stroke last:border-b-0 odd:bg-ui-panel even:bg-ui-table">{Array.from({ length: columns }, (_, cell) => <td key={cell} className={columns > 2 ? "px-4 py-3" : "px-4 py-3.5"}><SkeletonText className={cell === 0 ? "w-4/5" : "ml-auto w-1/2"} />{notes && <div className="mt-1 text-caption"><SkeletonText className="w-3/4" /></div>}</td>)}</tr>)}</tbody>
    </table>
  </div></section>;
}

export function ActivitySkeleton({ range }: { range: ActivityDateRange }) {
  const volume = buildActivityVolumeBoundarySkeleton(range, "UTC");
  return <LoadingRegion label="Loading analytics report">
    <div className="activity-summary grid grid-cols-4 gap-2">{[0, 1, 2, 3].map(index => <div key={index} className="min-w-0 rounded-xl border border-ui-stroke bg-ui-panel px-3 py-4">
      <div className="text-body"><SkeletonText className="w-3/4" /></div><div className="mb-1 mt-1 text-page min-[1151px]:mb-2 min-[1151px]:mt-2"><SkeletonText className="w-2/5" /></div><div className="h-[2lh] text-caption min-[1151px]:h-[1lh]"><SkeletonText className="w-full" /></div>
    </div>)}</div>
    <div className="mt-6 flex min-w-0 flex-col gap-6">
      <TableSkeleton title="Workflow outcomes" columns={5} />
      <ActivityDurationsSkeleton />
      <section><h2 className="mb-3 mt-0 text-section">{activityVolumeTitle(volume.granularity)}</h2><div className="rounded-lg border border-ui-stroke bg-ui-panel px-3 pb-3 pt-4"><Skeleton className="aspect-[25/8] max-h-56 min-h-40 w-full rounded-sm" /></div></section>
      <TableSkeleton title="Confirmed transactions" notes />
      <TableSkeleton title="Evidence coverage" />
      <TableSkeleton title="Run performance" rows={4} notes />
    </div>
  </LoadingRegion>;
}
