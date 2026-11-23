import { useEffect, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Spinner, Button, EmptyState, FailureNotice, PageHeading, useSkeletonWait } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { ActivityBreadcrumbs, ActivityDrilldown } from './activity-drilldown.js';
import type { ActivityDrilldownData, ActivityBrowse, ActivitySelectionHandler } from './activity-drilldown-model.js';
import { ActivitySkeleton } from "./activity-loading.js";
import type { ActivityDateRange } from "./activity-model.js";
import { analyticsPeriodLabel, finished, type AnalyticsData } from "./analytics-model.js";
import { AnalyticsSections, AnalyticsToolbar } from "./analytics-view.js";
import type { ActivityViewState } from "./activity-view-model.js";

const noRuns = (analytics: AnalyticsData) => analytics.running === 0 && analytics.workflows.every(row => finished(row) === 0);

/** Says the report is from the period last read; like a skeleton, it shows only once the new period has been slow. */
function StaleMark() {
  const waiting = useSkeletonWait();
  return <span role="status" data-analytics-stale className={cn("text-body text-ui-muted", waiting && "invisible")}>Updating</span>;
}

export function ActivityView({ data, range, today, onRange, onExport, onRetry, notice, selection, onSelection, browse, pending = false, blocked = false }: {
  data: ActivityViewState; range: ActivityDateRange; today: string;
  onRange: (range: ActivityDateRange) => void; onRetry?: () => void;
  onExport?: (format: "csv" | "xlsx") => void | Promise<void>; notice?: string;
  browse?: ActivityDrilldownData; pending?: boolean; blocked?: boolean;
  selection?: ActivityBrowse | null; onSelection?: ActivitySelectionHandler;
}) {
  const [exporting, setExporting] = useState<object>();
  const [chosen, setWorkflow] = useState("all");
  const workflow = data.state !== "loaded" || chosen === "all" || data.report.analytics.workflows.some(row => row.id === chosen) ? chosen : "all";
  /** The report on screen belongs to an earlier period while the chosen one loads: it keeps its own period and opens nothing. */
  const held = data.state === "loaded" && blocked && (data.report.range.from !== range.from || data.report.range.to !== range.to);
  const [exportError, setExportError] = useState<{ report: ActivityViewState; reason: string }>();
  const latest = useRef(data); latest.current = data;
  const requestRef = useRef<object | undefined>(undefined);
  useEffect(() => () => { requestRef.current = undefined; }, []);
  const exportCsv = async () => {
    if (!onExport || data.state !== 'loaded' || requestRef.current) return;
    const report = data; const request = {}; requestRef.current = request; setExporting(request); setExportError(undefined);
    try { await onExport('csv'); }
    catch { if (requestRef.current === request && latest.current === report) setExportError({ report, reason: 'CSV export unavailable. Try again from this report.' }); }
    finally { if (requestRef.current === request) { requestRef.current = undefined; setExporting(undefined); } }
  };
  const browsing = data.state === 'loaded' && !!selection && !!onSelection;
  return <section aria-label="Analytics report" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    {selection && onSelection && data.state === 'loaded' && <ActivityBreadcrumbs report={data.report} selection={selection} onSelection={onSelection} browse={browse} />}
    {!browsing && <PageHeading title="Analytics" description="How your workflows are going." />}
    {!browsing && <AnalyticsToolbar range={range} today={today} onRange={onRange}
      workflows={data.state === "loaded" ? data.report.analytics.workflows : []} workflow={workflow} onWorkflow={setWorkflow}
      exportButton={<span className="flex items-center gap-2">{held && <StaleMark />}<Button variant="secondary" aria-busy={!!exporting || undefined} disabled={data.state !== "loaded" || pending || blocked || !onExport || !!exporting} icon={exporting ? <span aria-hidden><Spinner /></span> : undefined} onClick={() => void exportCsv()}>Export</Button></span>} />}
    {exportError?.report === data && <p role="alert" className="m-0 text-body text-ui-danger">{exportError.reason}</p>}
    {notice && data.state === "loaded" && !(browsing && browse?.state === "unavailable") && <p role="status" className="m-0 text-body text-ui-secondary">{notice}</p>}
    <div className="min-w-0" aria-busy={data.state === "loading" || pending || held || undefined}>
      {data.state === "loaded" ? selection && onSelection ? <ActivityDrilldown report={data.report} selection={selection} onSelection={onSelection} browse={browse} pending={pending} blocked={blocked} onRetry={onRetry} /> : noRuns(data.report.analytics) ? <EmptyState icon={<BarChart3 aria-hidden className="size-6 text-ui-muted" />} title="No runs in this period" description={held ? analyticsPeriodLabel(data.report.range) : "Pick another period to see how your workflows are going."} /> : <AnalyticsSections data={data.report.analytics} range={held ? data.report.range : range} workflow={workflow} onRange={onRange} openRunsLocked={held} onOpenRuns={onSelection && data.report.runs ? id => onSelection({ metric: data.report.analytics.workflows.find(row => row.id === id)?.failed ? "failed" : "completed", workflow: id, page: 0 }) : undefined} />
        : data.state === "loading" ? <ActivitySkeleton />
        : onRetry ? <FailureNotice sentence="Couldn't load Analytics." action={{ label: "Retry", onClick: onRetry }} />
        : <p role="alert" className="m-0 text-body text-ui-danger">{data.reason}</p>}
    </div>
  </section>;
}
