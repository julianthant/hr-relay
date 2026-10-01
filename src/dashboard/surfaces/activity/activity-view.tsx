import { useState, type ReactNode } from "react";
import { BarChart3, ChevronDown, Download, Info } from "lucide-react";
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Select, Skeleton, TakeoverFrame } from "../../ds/ui.js";
import { ACTIVITY_DATE_PRESETS, type ActivityDatePreset, type ActivityDateRange } from "../activity-model.js";
import { ActivityRange } from "./activity-range.js";
import { ActivityVolume } from "./activity-volume.js";
import { activityDuration, activityFailureRate, type ActivitySummary, type ActivityViewState } from "./activity-view-model.js";

function Metrics({ report }: { report: ActivitySummary }) {
  const metrics = [
    { label: "Completed", value: String(report.completed), note: `of ${report.total} runs in this period` },
    { label: "Outstanding", value: String(report.outstanding), note: `${report.running} running · ${report.waiting} waiting`, tone: "text-ui-warning" },
    { label: "Failed", value: String(report.failed), note: activityFailureRate(report.failed, report.terminal), tone: report.failed ? "text-ui-danger" : undefined },
    { label: "Median duration", value: activityDuration(report.duration.medianSeconds), note: `${report.duration.measured} measured · ${report.duration.unmeasured} unmeasured terminal runs` },
  ];
  return <dl aria-label="Activity summary" className="m-0 grid grid-cols-2 overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel min-[1151px]:grid-cols-4">
    {metrics.map((metric, index) => <div key={metric.label} className={`min-w-0 px-5 py-5 ${index % 2 === 0 ? "border-r border-ui-stroke" : ""} ${index < 2 ? "border-b border-ui-stroke min-[1151px]:border-b-0" : ""} ${index === 1 ? "min-[1151px]:border-r min-[1151px]:border-ui-stroke" : ""}`}>
      <dt className="text-body text-ui-secondary">{metric.label}</dt><dd className={`mb-2 ml-0 mt-2 tabular-nums ${metric.value === "Unavailable" ? "text-section" : "text-workflow font-normal"} ${metric.tone ?? "text-ui-primary"}`}>{metric.value}</dd><p className="m-0 text-caption text-ui-muted">{metric.note}</p>
    </div>)}
  </dl>;
}

function Outcomes({ report }: { report: ActivitySummary }) {
  return <section aria-labelledby="activity-outcomes" className="min-w-0"><h2 id="activity-outcomes" className="mb-3 mt-0 text-section">Workflow outcomes</h2>
    <table aria-label="Workflow outcomes" className="w-full table-fixed border-collapse text-body"><colgroup><col className="w-[38%]" /><col /><col /><col /><col /></colgroup>
      <thead className="text-caption text-ui-muted"><tr className="border-b border-ui-stroke"><th scope="col" className="pb-3 pr-3 text-left font-medium">Workflow</th>{["Completed", "Outstanding", "Failed", "Total runs"].map(label => <th key={label} scope="col" className="pb-3 pl-2 text-right font-medium">{label}</th>)}</tr></thead>
      <tbody>{report.workflows.map(workflow => <tr key={workflow.id} className="border-b border-ui-stroke last:border-b-0"><th scope="row" className="py-4 pr-3 text-left font-medium"><span className="block text-control">{workflow.label}</span>{workflow.version && <span className="mt-1 block text-caption font-normal text-ui-muted">Version {workflow.version}</span>}</th><td className="py-4 pl-2 text-right tabular-nums">{workflow.completed}</td><td className="py-4 pl-2 text-right tabular-nums">{workflow.outstanding}</td><td className={`py-4 pl-2 text-right tabular-nums ${workflow.failed ? "text-ui-danger" : ""}`}>{workflow.failed}</td><td className="py-4 pl-2 text-right font-semibold tabular-nums">{workflow.total}</td></tr>)}</tbody>
    </table>
    {!report.workflows.length && <p className="border-b border-ui-stroke py-6 text-center text-body text-ui-secondary">No workflow activity in this period</p>}
  </section>;
}

function Transactions({ report }: { report: ActivitySummary }) {
  return <section aria-labelledby="activity-transactions"><h2 id="activity-transactions" className="mb-3 mt-0 text-section">Confirmed transactions</h2>
    <dl className="m-0 overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel">{report.transactions.map(transaction => <div key={transaction.id} className="flex items-center gap-4 border-b border-ui-stroke px-4 py-3.5 last:border-b-0"><dt className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-control font-medium">{transaction.label}</span><span className="text-caption text-ui-muted">{transaction.environment === "test" ? "Test receipts" : "Production receipts"} confirmed in this period</span></dt><dd className="m-0 text-section tabular-nums">{transaction.count}</dd></div>)}</dl>
    {!report.transactions.length && <p className="text-body text-ui-secondary">No confirmed transactions in this period</p>}
  </section>;
}

function Coverage({ report }: { report: ActivitySummary }) {
  return <section aria-labelledby="activity-coverage"><h2 id="activity-coverage" className="mb-3 mt-0 text-section">Evidence coverage</h2><dl className="m-0 text-body">
    <div className="flex justify-between gap-4 border-b border-ui-stroke pb-3"><dt className="text-ui-secondary">Readback verified</dt><dd className="m-0 text-right tabular-nums">{report.evidence.verified === null ? "Unavailable" : `${report.evidence.verified} of ${report.completed} completed`}</dd></div>
    <div className="flex justify-between gap-4 pt-3"><dt className="text-ui-secondary">Unread</dt><dd className="m-0 text-right tabular-nums">{report.evidence.unread === null ? "Unavailable" : `${report.evidence.unread} completed ${report.evidence.unread === 1 ? "run" : "runs"}`}</dd></div>
  </dl></section>;
}

export function ActivityView({ data, range, today, period, onPreset, onRange, onExport, sampleControl, notice }: {
  data: ActivityViewState; range: ActivityDateRange; today: string; period: ActivityDatePreset;
  onPreset: (preset: ActivityDatePreset) => void; onRange: (range: ActivityDateRange) => void;
  onExport: (format: "csv" | "xlsx") => void; sampleControl?: ReactNode; notice?: string;
}) {
  const [rangeOpen, setRangeOpen] = useState(false);
  return <TakeoverFrame label="Activity report" className="ui-theme-scope bg-ui-canvas font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    <header className="mx-3 mt-3 flex min-h-12 shrink-0 flex-wrap items-center gap-3 rounded-lg border border-ui-stroke bg-ui-panel px-4 py-2"><BarChart3 aria-hidden className="size-4 text-ui-muted" /><h1 className="m-0 text-heading">Activity</h1><span className="border-l border-ui-stroke pl-3"><ActivityRange range={range} today={today} open={rangeOpen} onOpenChange={setRangeOpen} onApply={onRange} /></span><div className="ml-auto flex items-center gap-2">{sampleControl}
      <Select aria-label="Report period" variant="toolbar" value={period} onChange={event => { const preset = event.target.value as ActivityDatePreset; if (preset === "custom") setRangeOpen(true); else onPreset(preset); }}>{ACTIVITY_DATE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</Select>
      <Popover><PopoverTrigger asChild><Button size="toolbar" variant="secondary" disabled={data.state !== "loaded"} icon={<Download aria-hidden className="size-3.5" />}>Export report<ChevronDown aria-hidden className="size-3" /></Button></PopoverTrigger><PopoverContent title="Export report" hideTitle hideClose align="end" width="sm" className="ui-theme-scope bg-ui-panel font-ui text-ui-primary"><div className="flex flex-col gap-1"><Button variant="ghost" className="justify-start" onClick={() => onExport("csv")}>CSV</Button><Button variant="ghost" className="justify-start" onClick={() => onExport("xlsx")}>Excel workbook</Button></div><p className="mb-0 mt-3 text-caption text-ui-muted">Exports will be connected during backend integration.</p></PopoverContent></Popover>
      <Popover><PopoverTrigger asChild><IconButton label="How this report is counted" size="sm" icon={<Info aria-hidden className="size-3.5" />} /></PopoverTrigger><PopoverContent title="How this report is counted" align="end" width="md" className="ui-theme-scope bg-ui-panel font-ui text-ui-primary"><p className="mt-0 text-body text-ui-secondary">Run outcomes are counted by their start date in the selected period. Outstanding means running or waiting. The failure rate uses terminal runs.</p><p className="mb-0 text-body text-ui-secondary">Median duration uses measured terminal runs. Confirmed transactions use receipt dates and remain separate from run totals. Dates use {data.state === "loaded" ? data.report.timeZone : "the report time zone"}.</p></PopoverContent></Popover>
    </div></header>
    {notice && <p role="status" className="mx-3 mb-0 mt-2 text-body text-ui-secondary">{notice}</p>}
    <div className="m-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-ui-stroke bg-ui-canvas p-6" aria-busy={data.state === "loading" || undefined}>
      {data.state === "loaded" ? <><Metrics report={data.report} /><div className="mt-6 grid grid-cols-1 gap-6 min-[1151px]:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]"><div className="flex min-w-0 flex-col gap-6"><Outcomes report={data.report} /><Transactions report={data.report} /></div><div className="flex min-w-0 flex-col gap-6"><ActivityVolume volume={data.report.volume} /><Coverage report={data.report} /></div></div></> : data.state === "loading" ? <div role="status" aria-label="Loading activity report"><div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-32 rounded-lg" />)}</div><Skeleton className="mt-6 h-64 rounded-lg" /><p className="text-body text-ui-secondary">Loading activity…</p></div> : <div role="alert" className="flex min-h-72 flex-col items-center justify-center text-center"><BarChart3 aria-hidden className="mb-4 size-6 text-ui-muted" /><h2 className="m-0 text-section">Activity unavailable</h2><p className="mb-0 mt-2 max-w-md text-body text-ui-secondary">{data.reason}</p></div>}
    </div>
  </TakeoverFrame>;
}
