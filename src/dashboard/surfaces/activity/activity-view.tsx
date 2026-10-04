import { useId, useState, type ReactNode } from "react";
import { BarChart3, ChevronDown, ChevronRight, Download, Info } from "lucide-react";
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Select, Skeleton, PageHeading } from "../../ds/ui.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../ds/dropdown-menu.js';
import { ACTIVITY_DATE_PRESETS, type ActivityDatePreset, type ActivityDateRange } from "../activity-model.js";
import { ActivityRange } from "./activity-range.js";
import { ActivityVolume } from "./activity-volume.js";
import { activityCompletionRate, activityDuration, activityFailureRate, type ActivitySummary, type ActivityViewState, type ActivityWorkflow } from "./activity-view-model.js";

function Metrics({ report }: { report: ActivitySummary }) {
  const metrics = [
    { label: "Completed", value: String(report.completed), note: `of ${report.total} runs in this period` },
    { label: "Outstanding", value: String(report.outstanding), note: `${report.running} running · ${report.waiting} waiting`, tone: "text-ui-warning" },
    { label: "Failed", value: String(report.failed), note: activityFailureRate(report.failed, report.terminal), tone: report.failed ? "text-ui-danger" : undefined },
    { label: "Median duration", value: activityDuration(report.duration.medianSeconds), note: `${report.duration.measured} measured · ${report.duration.unmeasured} unmeasured` },
  ];
  return <dl aria-label="Activity summary" className="activity-summary m-0 grid grid-cols-4 gap-2">
    {metrics.map(metric => <div key={metric.label} className="min-w-0 rounded-xl border border-ui-stroke bg-ui-panel px-3 py-4">
      <dt className="text-body text-ui-secondary">{metric.label}</dt><dd className={`mb-1 ml-0 mt-1 tabular-nums min-[1151px]:mb-2 min-[1151px]:mt-2 ${metric.value === "Unavailable" ? "text-section" : "text-page font-normal"} ${metric.tone ?? "text-ui-primary"}`}>{metric.value}</dd><p className="m-0 text-caption text-ui-muted">{metric.note}</p>
    </div>)}
  </dl>;
}

function OutcomeRow({ workflow, initiallyExpanded }: { workflow: ActivityWorkflow; initiallyExpanded: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const detailsId = useId();
  return <tbody className={`border-b border-ui-stroke last:border-b-0 ${expanded ? "bg-ui-table" : "bg-ui-panel"}`}>
    <tr><th scope="row" className="px-4 py-3 text-left font-normal">
      {workflow.version ? <button type="button" className="flex w-full items-center gap-2 rounded-md text-left text-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ui-info" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}><ChevronRight aria-hidden className={`size-3.5 shrink-0 text-ui-secondary ${expanded ? "rotate-90" : ""}`} />{workflow.label}</button> : <span className="block pl-5.5 text-control">{workflow.label}</span>}
    </th><td className="px-2 py-3 text-right tabular-nums">{workflow.completed}</td><td className="px-2 py-3 text-right tabular-nums">{workflow.outstanding}</td><td className={`px-2 py-3 text-right tabular-nums ${workflow.failed ? "text-ui-danger" : ""}`}>{workflow.failed}</td><td className="py-3 pl-2 pr-4 text-right tabular-nums">{workflow.total}</td></tr>
    {workflow.version && <tr id={detailsId} hidden={!expanded}><td colSpan={5} className="pb-4 pl-9.5 pr-4"><dl className="m-0 flex items-baseline gap-6 text-body"><dt className="text-ui-secondary">Version</dt><dd className="m-0">{workflow.version}</dd></dl></td></tr>}
  </tbody>;
}

function Outcomes({ report }: { report: ActivitySummary }) {
  return <section aria-labelledby="activity-outcomes" className="min-w-0"><h2 id="activity-outcomes" className="mb-3 mt-0 text-section">Workflow outcomes</h2>
    <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-table"><table aria-label="Workflow outcomes" className="w-full table-fixed border-collapse text-body"><colgroup><col className="w-[30%]" /><col /><col /><col /><col /></colgroup>
      <thead className="bg-ui-panel text-caption text-ui-secondary"><tr className="border-b border-ui-stroke"><th scope="col" className="px-4 py-3 text-left font-normal">Workflow</th>{["Completed", "Outstanding", "Failed", "Total runs"].map(label => <th key={label} scope="col" className="px-2 py-3 text-right font-normal last:pr-4">{label}</th>)}</tr></thead>
      {report.workflows.map((workflow, index) => <OutcomeRow key={workflow.id} workflow={workflow} initiallyExpanded={index === 0} />)}
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

export function ActivityView({ data, range, period, onPreset, onRange, onExport, sampleControl, notice }: {
  data: ActivityViewState; range: ActivityDateRange; today: string; period: ActivityDatePreset;
  onPreset: (preset: ActivityDatePreset) => void; onRange: (range: ActivityDateRange) => void;
  onExport: (format: "csv" | "xlsx") => void; sampleControl?: ReactNode; notice?: string;
}) {
  return <section aria-label="Activity report" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Activity" description="Run outcomes, volume and performance." actions={<>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="toolbar" variant="secondary" disabled={data.state !== "loaded"} icon={<Download aria-hidden className="size-3.5" />}>Export report<ChevronDown aria-hidden className="size-3" /></Button></DropdownMenuTrigger><DropdownMenuContent aria-label="Export report" align="end" className="w-60"><DropdownMenuGroup><DropdownMenuItem onSelect={() => onExport("csv")}>CSV</DropdownMenuItem><DropdownMenuItem onSelect={() => onExport("xlsx")}>Excel workbook</DropdownMenuItem></DropdownMenuGroup><p className="m-0 px-2 py-2 text-caption text-ui-muted">Exports will be connected during backend integration.</p></DropdownMenuContent></DropdownMenu>
      <Popover><PopoverTrigger asChild><IconButton label="How this report is counted" size="sm" icon={<Info aria-hidden className="size-3.5" />} /></PopoverTrigger><PopoverContent title="How this report is counted" align="end" width="md" className="ui-theme-scope bg-ui-panel font-ui text-ui-primary"><p className="mt-0 text-body text-ui-secondary">Run outcomes use start dates. Outstanding means running or waiting; failure rate uses terminal runs. Median duration uses measured terminal runs.</p><p className="mb-0 text-body text-ui-secondary">Confirmed transactions use receipt dates and stay separate from run totals. Dates use {data.state === "loaded" ? data.report.timeZone : "the report time zone"}.</p></PopoverContent></Popover>
    </>} />
    <div className="activity-header-filters"><div className="min-w-0">{sampleControl}</div><Select aria-label="Report period" variant="toolbar" value={period} onChange={event => onPreset(event.target.value as ActivityDatePreset)}>{ACTIVITY_DATE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</Select></div>
    {period === "custom" && <ActivityRange range={range} onApply={onRange} />}
    {notice && <p role="status" className="m-0 text-body text-ui-secondary">{notice}</p>}
    <div className="min-w-0" aria-busy={data.state === "loading" || undefined}>
      {data.state === "loaded" ? <><Metrics report={data.report} /><div className="mt-6 flex min-w-0 flex-col gap-6"><Outcomes report={data.report} /><ActivityVolume volume={data.report.volume} /><Transactions report={data.report} /><Coverage report={data.report} /><Performance report={data.report} /></div></> : data.state === "loading" ? <div role="status" aria-label="Loading activity report"><div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-24 rounded-lg min-[1151px]:h-32" />)}</div><Skeleton className="mt-6 h-64 rounded-lg" /></div> : <div role="alert" className="flex min-h-72 flex-col items-center justify-center text-center"><BarChart3 aria-hidden className="mb-4 size-6 text-ui-muted" /><h2 className="m-0 text-section">Activity unavailable</h2><p className="mb-0 mt-2 max-w-md text-body text-ui-secondary">{data.reason}</p></div>}
    </div>
  </section>;
}
