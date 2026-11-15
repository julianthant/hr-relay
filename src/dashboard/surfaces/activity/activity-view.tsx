import { useEffect, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Spinner, Button, PageHeading } from "../../ds/ui.js";
import { ActivityBreadcrumbs, ActivityDrilldown } from './activity-drilldown.js';
import type { ActivityDrilldownData, ActivityBrowse, ActivitySelectionHandler } from './activity-drilldown-model.js';
import { ActivitySkeleton } from "./activity-loading.js";
import type { ActivityDateRange } from "./activity-model.js";
import { AnalyticsSections, AnalyticsToolbar } from "./analytics-view.js";
import type { ActivityViewState } from "./activity-view-model.js";

export function ActivityView({ data, range, today, onRange, onExport, notice, selection, onSelection, browse, pending = false, blocked = false }: {
  data: ActivityViewState; range: ActivityDateRange; today: string;
  onRange: (range: ActivityDateRange) => void;
  onExport?: (format: "csv" | "xlsx") => void | Promise<void>; notice?: string;
  browse?: ActivityDrilldownData; pending?: boolean; blocked?: boolean;
  selection?: ActivityBrowse | null; onSelection?: ActivitySelectionHandler;
}) {
  const [exporting, setExporting] = useState<object>();
  const [chosen, setWorkflow] = useState("all");
  const workflow = data.state !== "loaded" || chosen === "all" || data.report.analytics.workflows.some(row => row.id === chosen) ? chosen : "all";
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
  return <section aria-label="Analytics report" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    {selection && onSelection && data.state === 'loaded' && <ActivityBreadcrumbs report={data.report} selection={selection} onSelection={onSelection} browse={browse} />}
    <PageHeading title="Analytics" description="How your workflows are going." />
    <AnalyticsToolbar range={range} today={today} onRange={onRange}
      workflows={data.state === "loaded" ? data.report.analytics.workflows : []} workflow={workflow} onWorkflow={setWorkflow}
      exportButton={<Button variant="secondary" aria-busy={!!exporting || undefined} disabled={data.state !== "loaded" || pending || blocked || !onExport || !!exporting} icon={exporting ? <span aria-hidden><Spinner /></span> : undefined} onClick={() => void exportCsv()}>Export</Button>} />
    {exportError?.report === data && <p role="alert" className="m-0 text-body text-ui-danger">{exportError.reason}</p>}
    {notice && <p role="status" className="m-0 text-body text-ui-secondary">{notice}</p>}
    <div className="min-w-0" aria-busy={data.state === "loading" || pending || undefined}>
      {data.state === "loaded" ? selection && onSelection ? <ActivityDrilldown report={data.report} selection={selection} onSelection={onSelection} browse={browse} pending={pending} blocked={blocked} /> : <AnalyticsSections data={data.report.analytics} range={range} workflow={workflow} onRange={onRange} onOpenRuns={onSelection && data.report.runs ? id => onSelection({ metric: data.report.analytics.workflows.find(row => row.id === id)?.failed ? "failed" : "completed", workflow: id, page: 0 }) : undefined} /> : data.state === "loading" ? <ActivitySkeleton /> : <div role="alert" className="flex min-h-72 flex-col items-center justify-center text-center"><BarChart3 aria-hidden className="mb-4 size-6 text-ui-muted" /><h2 className="m-0 text-section">Analytics unavailable</h2><p className="mb-0 mt-2 max-w-md text-body text-ui-secondary">{data.reason}</p></div>}
    </div>
  </section>;
}
