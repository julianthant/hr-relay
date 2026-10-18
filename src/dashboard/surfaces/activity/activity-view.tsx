import { ActivityDurations } from "./activity-duration.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { Spinner, Button, Select, PageHeading, dsFocus } from "../../ds/ui.js";
import { ActivityBreadcrumbs, ActivityDrilldown } from './activity-drilldown.js';
import type { ActivityDrilldownData, ActivityBrowse, ActivitySelectionHandler } from './activity-drilldown-model.js';
import { ActivitySkeleton } from "./activity-loading.js";
import { ACTIVITY_DATE_PRESETS, type ActivityDatePreset, type ActivityDateRange } from "./activity-model.js";
import { ActivityRange } from "./activity-range.js";
import { ActivityVolume } from "./activity-volume.js";
import { activityCompletionRate, activityDuration, activityFailureRate, type ActivitySummary, type ActivityViewState } from "./activity-view-model.js";

function Metrics({ report, onSelection }: { report: ActivitySummary; onSelection?: (next: ActivityBrowse) => void }) {
  const metrics = [
    { label: "Completed", metric: 'completed' as const, value: String(report.completed), note: `of ${report.total} runs in this period` },
    { label: "Outstanding", metric: 'outstanding' as const, value: String(report.outstanding), note: `${report.running} running · ${report.waiting} waiting`, tone: "text-ui-warning" },
    { label: "Failed", metric: 'failed' as const, value: String(report.failed), note: activityFailureRate(report.failed, report.terminal), tone: report.failed ? "text-ui-danger" : undefined },
    { label: "Median duration", value: activityDuration(report.duration.medianSeconds), note: `${report.duration.measured} measured · ${report.duration.unmeasured} unmeasured` },
  ];
  return <dl aria-label="Analytics summary" className="activity-summary m-0 grid grid-cols-4 gap-2">
    {metrics.map(metric => <div key={metric.label} className="relative min-w-0 rounded-xl border border-ui-stroke bg-ui-panel px-3 py-4">
      <dt className="text-body text-ui-secondary">{metric.label}</dt><dd className={`mb-1 ml-0 mt-1 tabular-nums min-[1151px]:mb-2 min-[1151px]:mt-2 ${metric.value === "Unavailable" ? "text-section" : "text-page font-normal"} ${metric.tone ?? "text-ui-primary"}`}>{metric.value}</dd><p className="m-0 text-caption text-ui-muted">{metric.note}</p>
      {metric.metric && onSelection && <button type="button" aria-label={`View ${metric.label.toLowerCase()} runs (${metric.value})`} className={`absolute inset-0 cursor-pointer rounded-xl hover:bg-ui-hover/30 ${dsFocus}`} onClick={() => onSelection({ metric: metric.metric, page: 0 })} />}
    </div>)}
  </dl>;
}

function Outcomes({ report }: { report: ActivitySummary }) {
  return <section aria-labelledby="activity-outcomes" className="min-w-0"><h2 id="activity-outcomes" className="mb-3 mt-0 text-section">Workflow outcomes</h2>
    <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-table"><table aria-label="Workflow outcomes" className="w-full table-fixed border-collapse text-body"><colgroup><col className="w-[30%]" /><col /><col /><col /><col /></colgroup>
      <thead className="bg-ui-table text-caption text-ui-secondary"><tr className="border-b border-ui-stroke"><th scope="col" className="px-4 py-3 text-left font-normal">Workflow</th>{["Completed", "Outstanding", "Failed", "Total runs"].map(label => <th key={label} scope="col" className="px-2 py-3 text-right font-normal last:pr-4">{label}</th>)}</tr></thead>
      <tbody>{report.workflows.map(workflow => <tr key={workflow.id} className="border-b border-ui-stroke last:border-b-0 odd:bg-ui-panel even:bg-ui-table">
        <th scope="row" className="px-4 py-3 text-left font-normal">{workflow.label}</th>
        <td className="px-2 py-3 text-right tabular-nums">{workflow.completed}</td><td className="px-2 py-3 text-right tabular-nums">{workflow.outstanding}</td>
        <td className={`px-2 py-3 text-right tabular-nums ${workflow.failed ? "text-ui-danger" : ""}`}>{workflow.failed}</td><td className="py-3 pl-2 pr-4 text-right tabular-nums">{workflow.total}</td>
      </tr>)}</tbody>
      {!report.workflows.length && <tbody><tr><td colSpan={5} className="px-4 py-6 text-center text-ui-secondary">No workflow activity in this period</td></tr></tbody>}
    </table></div>
  </section>;
}

function RecordTable({ label, rows }: {
  label: string; rows: readonly { id: string; label: string; note?: string; value: ReactNode }[];
}) {
  return <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-panel"><table aria-label={label} className="w-full border-collapse text-body"><tbody>
    {rows.map(row => <tr key={row.id} className="border-b border-ui-stroke last:border-b-0"><th scope="row" className="px-4 py-3.5 text-left font-normal"><span className="block text-control">{row.label}</span>{row.note && <span className="mt-1 block text-caption font-normal text-ui-muted">{row.note}</span>}</th><td className="px-4 py-3.5 text-right text-body tabular-nums">{row.value}</td></tr>)}
  </tbody></table></div>;
}

function Transactions({ report }: { report: ActivitySummary }) {
  return <section aria-labelledby="activity-transactions"><h2 id="activity-transactions" className="mb-3 mt-0 text-section">Confirmed transactions</h2>
    {!!report.transactions.length && <RecordTable label="Confirmed transactions" rows={report.transactions.map(transaction => ({ id: transaction.id, label: transaction.label, note: `${transaction.environment === "test" ? "Test receipts" : "Production receipts"} confirmed in this period`, value: transaction.count }))} />}
    {!report.transactions.length && <p className="text-body text-ui-secondary">No confirmed transactions in this period</p>}
  </section>;
}

function Coverage({ report }: { report: ActivitySummary }) {
  return <section aria-labelledby="activity-coverage"><h2 id="activity-coverage" className="mb-3 mt-0 text-section">Evidence coverage</h2><RecordTable label="Evidence coverage" rows={[
    { id: "verified", label: "Readback verified", value: report.evidence.verified === null ? "Unavailable" : `${report.evidence.verified} of ${report.completed} completed` },
    { id: "unread", label: "Unread", value: report.evidence.unread === null ? "Unavailable" : `${report.evidence.unread} completed ${report.evidence.unread === 1 ? "run" : "runs"}` },
  ]} /></section>;
}

function Performance({ report }: { report: ActivitySummary }) {
  const commonFailures = report.failures === null ? null : [...report.failures].sort((left, right) => right.runs - left.runs);
  const common = commonFailures?.[0];
  return <section aria-labelledby="activity-performance"><h2 id="activity-performance" className="mb-3 mt-0 text-section">Run performance</h2><RecordTable label="Run performance" rows={[
    { id: "completion", label: "Completion rate", note: `${report.completed} of ${report.terminal} finished runs`, value: activityCompletionRate(report.completed, report.terminal) },
    { id: "longest", label: "Longest run", note: `Among ${report.duration.measured} measured runs`, value: activityDuration(report.duration.longestSeconds) },
    { id: "runtime", label: "Total measured runtime", note: `${report.duration.measured} measured · ${report.duration.unmeasured} unmeasured`, value: activityDuration(report.duration.totalSeconds) },
    { id: "failure", label: "Most common failure", ...(common ? { note: `${common.runs} ${common.runs === 1 ? "run" : "runs"}` } : {}), value: commonFailures === null ? "Unavailable" : common?.label ?? "No failures" },
  ]} /></section>;
}

export function ActivityView({ data, range, rangeRevision = 0, period, onPreset, onRange, onExport, notice, selection, onSelection, browse, pending = false, blocked = false }: {
  data: ActivityViewState; range: ActivityDateRange; today: string; period: ActivityDatePreset;
  rangeRevision?: number;
  onPreset: (preset: ActivityDatePreset) => void; onRange: (range: ActivityDateRange) => void;
  onExport?: (format: "csv" | "xlsx") => void | Promise<void>; notice?: string;
  browse?: ActivityDrilldownData; pending?: boolean; blocked?: boolean;
  selection?: ActivityBrowse | null; onSelection?: ActivitySelectionHandler;
}) {
  const [exporting, setExporting] = useState<object>();
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
    <PageHeading title="Analytics" description="Run outcomes, volume and performance." />
    <div className="activity-header-filters"><div className="activity-period-controls"><Select aria-label="Report period" variant="toolbar" value={period} onChange={event => onPreset(event.target.value as ActivityDatePreset)}>{ACTIVITY_DATE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</Select><ActivityRange key={rangeRevision} range={range} onApply={onRange} onEdit={() => onPreset('custom')} /></div><Button variant="secondary" aria-busy={!!exporting || undefined} disabled={data.state !== "loaded" || pending || blocked || !onExport || !!exporting} icon={exporting ? <span aria-hidden><Spinner /></span> : undefined} onClick={() => void exportCsv()}>Export CSV</Button></div>
    {exportError?.report === data && <p role="alert" className="m-0 text-body text-ui-danger">{exportError.reason}</p>}
    {notice && <p role="status" className="m-0 text-body text-ui-secondary">{notice}</p>}
    <div className="min-w-0" aria-busy={data.state === "loading" || pending || undefined}>
      {data.state === "loaded" ? selection && onSelection ? <ActivityDrilldown report={data.report} selection={selection} onSelection={onSelection} browse={browse} pending={pending} blocked={blocked} /> : <><Metrics report={data.report} onSelection={data.report.runs ? onSelection : undefined} /><div className="mt-6 flex min-w-0 flex-col gap-6"><Outcomes report={data.report} /><ActivityDurations report={data.report} onWorkflow={data.report.runs && onSelection ? workflow => onSelection({ metric: 'timed', workflow, page: 0 }) : undefined} /><ActivityVolume volume={data.report.volume} /><Transactions report={data.report} /><Coverage report={data.report} /><Performance report={data.report} /></div></> : data.state === "loading" ? <ActivitySkeleton range={range} /> : <div role="alert" className="flex min-h-72 flex-col items-center justify-center text-center"><BarChart3 aria-hidden className="mb-4 size-6 text-ui-muted" /><h2 className="m-0 text-section">Analytics unavailable</h2><p className="mb-0 mt-2 max-w-md text-body text-ui-secondary">{data.reason}</p></div>}
    </div>
  </section>;
}
