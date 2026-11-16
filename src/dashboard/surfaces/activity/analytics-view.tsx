import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState, type CSSProperties } from "react";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { BodySection, Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, SegmentedChoice, dsIcon } from "../../ds/ui.js";
import { ChartHeading, KeyFigures, LineChart, StackedBars } from "./analytics-charts.js";
import type { ActivityDateRange } from "./activity-model.js";
import { analyticsBuckets, analyticsClock, analyticsPeriodLabel, finished, shiftDate, shiftRange, type AnalyticsData, type AnalyticsWorkflow } from "./analytics-model.js";

const QUICK = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }] as const;
type Quick = (typeof QUICK)[number]["value"];
const quickRange = (quick: Quick, today: string): ActivityDateRange => ({ from: shiftDate(today, 1 - Number.parseInt(quick, 10)), to: today });
const NUMBER = "!text-right tabular-nums";
const OUTCOMES = [
  { key: "done", label: "Done", color: "var(--chart-done)" },
  { key: "failed", label: "Failed", color: "var(--chart-failed)" },
  { key: "attention", label: "Needs attention", color: "var(--chart-attention)" },
] as const;
const sum = (rows: readonly AnalyticsWorkflow[]) => ({ done: rows.reduce((n, r) => n + r.done, 0), failed: rows.reduce((n, r) => n + r.failed, 0), attention: rows.reduce((n, r) => n + r.attention, 0) });

/** The served Analytics toolbar: one period for every chart on the page, a workflow filter and the export. */
export function AnalyticsToolbar({ range, today, onRange, workflows, workflow, onWorkflow, exportButton }: {
  range: ActivityDateRange; today: string; onRange: (range: ActivityDateRange) => void;
  workflows: readonly AnalyticsWorkflow[]; workflow: string; onWorkflow: (id: string) => void; exportButton: React.ReactNode;
}) {
  const quick = QUICK.find(option => { const candidate = quickRange(option.value, today); return candidate.from === range.from && candidate.to === range.to; })?.value;
  return <>
    <div className="ds-toolbar-row flex flex-wrap items-center gap-2">
      <SegmentedChoice hideLabel label="Report period" value={(quick ?? "") as Quick} options={QUICK} onChange={value => onRange(quickRange(value, today))} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="ds-filter-trigger" iconAfter={<ChevronDown aria-hidden className="size-3.5 text-ui-muted" />}>{workflow === "all" ? "By workflow" : workflows.find(row => row.id === workflow)?.label}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[220px]"><DropdownMenuRadioGroup value={workflow} onValueChange={onWorkflow}>
          <DropdownMenuRadioItem value="all">All workflows</DropdownMenuRadioItem><DropdownMenuSeparator />
          {workflows.map(row => <DropdownMenuRadioItem key={row.id} value={row.id}>{row.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
      <span className="ml-auto">{exportButton}</span>
    </div>
  </>;
}

/** Runs, Workflows, Time and Why runs failed, for the selected period, on served data. */
export function AnalyticsSections({ data, range, workflow, onRange, onOpenRuns }: {
  data: AnalyticsData; range: ActivityDateRange; workflow: string; onRange: (range: ActivityDateRange) => void; onOpenRuns?: (workflowId: string) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const shown = data.workflows.filter(row => workflow === "all" || row.id === workflow);
  const buckets = analyticsBuckets(range, shown);
  const totals = sum(shown);
  const days = buckets.map(bucket => ({ label: bucket.label, date: bucket.date }));
  const series = OUTCOMES.map(outcome => ({ id: outcome.key, label: outcome.label, color: outcome.color, values: buckets.map(bucket => bucket[outcome.key]) }));
  const timeSeries = shown.map(row => ({ id: row.id, label: row.label, color: `var(--chart-${data.workflows.findIndex(item => item.id === row.id) % 6 + 1})`, values: buckets.map(bucket => bucket.seconds[row.id] ?? null) }));
  const longest = Math.max(0, ...timeSeries.flatMap(line => line.values.flatMap(value => value === null ? [] : [value])));
  const top = Math.max(60, Math.ceil(longest / 60) * 60);
  const typical = workflow === "all" ? data.typicalSeconds : shown[0]?.typicalSeconds ?? null;
  const reasons = data.reasons.filter(reason => workflow === "all" || shown.some(row => row.label === reason.workflow));
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="ds-body-stack mt-2">
    <BodySection title="Runs" description={`${totals.done + totals.failed} finished runs${workflow === "all" ? ` · ${data.running} still open` : ""}`}>
      <StackedBars label="Runs per day" days={days} series={series} unit={["run", "runs"]}
        header={<div className="mb-4 flex items-center justify-between gap-3"><span className="text-[13px] leading-[18px]">{analyticsPeriodLabel(range)}</span>
          <span className="flex items-center gap-1"><IconButton size="xs" label="Previous period" icon={<ChevronLeft aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, -1))} /><IconButton size="xs" label="Next period" icon={<ChevronRight aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, 1))} /></span></div>}
        footer={<div className="mt-4"><KeyFigures items={series.map(line => ({ label: line.label, color: line.color, count: line.values.reduce((n, value) => n + value, 0) }))} /></div>} />
    </BodySection>
    <BodySection title="Workflows" description="Open a row to see what went wrong.">
      {shown.length === 0 ? <p className="m-0 text-body text-ui-secondary">No workflow activity in this period</p> :
      <div className="ds-table-list-frame ds-usage-table"><table aria-label="Workflows" className="table-fixed">
        <colgroup><col className="w-10" /><col /><col className="w-[114px]" /><col className="w-[114px]" /><col className="w-[122px]" /><col className="w-[186px]" /></colgroup>
        <thead><tr><th scope="col" className="ds-usage-chevron"><span className="sr-only">Details</span></th><th scope="col" className="!pl-0">Workflow</th><th scope="col" className={NUMBER}>Runs</th><th scope="col" className={NUMBER}>Done</th><th scope="col" className={NUMBER}>Failed</th><th scope="col" className={NUMBER}>Typical time</th></tr></thead>
        <tbody>{shown.map(row => {
          const isOpen = open.has(row.id), total = finished(row);
          const percent = (n: number) => total === 0 ? "—" : `${Math.round(n / total * 100)}%`;
          const details: readonly { label: string; values: readonly (readonly [string, string])[] }[] = [
            { label: "Outcome", values: [["Done", percent(row.done)], ["Failed", percent(row.failed)], ["Waiting", percent(row.attention)]] },
            ...(row.failedAt.length === 0 ? [] : [{ label: "Failed at", values: row.failedAt.map(step => [step.label, String(step.runs)] as const) }]),
          ];
          const cols = Math.max(...details.map(detail => detail.values.length));
          return <Fragment key={row.id}>
            <tr className={`cursor-pointer ${isOpen ? "!border-b-0" : ""}`} data-open={isOpen || undefined} onClick={() => toggle(row.id)}>
              <td className="ds-usage-chevron"><IconButton size="xs" label={`${isOpen ? "Hide" : "Show"} ${row.label} details`} aria-expanded={isOpen} icon={<ChevronRight aria-hidden className={`size-5 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} />} onClick={event => { event.stopPropagation(); toggle(row.id); }} /></td>
              <td className="!pl-0">{row.label}</td><td className={NUMBER}>{total}</td><td className={NUMBER}>{percent(row.done)}</td><td className={`${NUMBER} ${row.failed ? "text-ui-danger" : ""}`}>{row.failed}</td><td className={NUMBER}>{analyticsClock(row.typicalSeconds)}</td>
            </tr>
            {isOpen && <tr data-open><td /><td colSpan={5} className="!h-auto !pl-0 !pt-1 !pb-4">
              <dl style={{ "--usage-cols": cols + 1 } as CSSProperties}>
                {details.map(detail => <Fragment key={detail.label}><dt>{detail.label}</dt>{detail.values.map(([name, figure]) => <dd key={name}>{name} <span className="tabular-nums">{figure}</span></dd>)}{Array.from({ length: cols - detail.values.length }, (_, index) => <dd key={index} aria-hidden />)}</Fragment>)}
              </dl>
              {onOpenRuns && <button type="button" className="mt-4 inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] font-normal leading-[18px] text-ui-primary hover:underline" onClick={() => onOpenRuns(row.id)}>Open runs <ArrowUpRight aria-hidden className={dsIcon.md} /></button>}
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>}
    </BodySection>
    {typical !== null && <BodySection title="Time" description="How long finished runs take.">
      <LineChart label="Typical time per day" days={days} series={timeSeries} ticks={[top, top / 2, 0].map(value => ({ value, label: value === 0 ? "0" : `${value / 60}m` }))} top={top} format={analyticsClock}
        summary={index => (buckets[index]?.step ?? 1) === 1 ? "Typical time" : "Average of daily typical times"}
        header={<ChartHeading label="Typical time" value={analyticsClock(typical)} />} />
    </BodySection>}
    {reasons.length > 0 && <BodySection title="Why runs failed" description="Failed runs in this period.">
      <RunList label="Why runs failed">{reasons.map(reason => <RunListRow key={`${reason.workflow}:${reason.label}`} title={reason.label} description={reason.workflow}><span className="text-[13px] tabular-nums">{reason.runs}</span></RunListRow>)}</RunList>
    </BodySection>}
  </div>;
}
