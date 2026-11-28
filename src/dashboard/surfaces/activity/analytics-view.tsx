import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { BodySection, Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, DelayedSpinner, IconButton, PageHeading, SegmentedChoice, StatusDot, dsIcon, dsText, type DsStatus } from "../../ds/ui.js";
import { ChartHeading, SmallLine, StackedBars } from "./analytics-charts.js";
import { isActivityCalendarDate, type ActivityDateRange } from "./activity-model.js";
import { analyticsBuckets, analyticsClock, analyticsPeriodLabel, bucketCounts, finished, rowTypicalSeconds, shiftDate, shiftRange, type AnalyticsData, type AnalyticsWorkflow } from "./analytics-model.js";

const QUICK = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }] as const;
type Quick = (typeof QUICK)[number]["value"];
const quickRange = (quick: Quick, today: string): ActivityDateRange => ({ from: shiftDate(today, 1 - Number.parseInt(quick, 10)), to: today });
const NUMBER = "!text-right tabular-nums";
const OUTCOMES: readonly { key: "done" | "failed" | "attention"; label: string; status: DsStatus; color: string }[] = [
  { key: "done", label: "Done", status: "verifiedDone", color: "var(--ds-status-verified-done-mark)" },
  { key: "failed", label: "Failed", status: "failed", color: "var(--ds-status-failed-mark)" },
  { key: "attention", label: "Needs attention", status: "waiting", color: "var(--ds-info-solid-bg)" },
];
const share = (count: number, total: number) => total === 0 ? "—" : `${Math.round(count / total * 100)}%`;

/** A small spinner after the period group while a read is in flight, after the skeleton wait; the slot keeps its room so nothing shifts. */
function ReadingSpinner({ reading }: { reading: boolean }) {
  return <span aria-hidden data-analytics-reading={reading ? "" : undefined} className="inline-flex size-4 items-center justify-center">{reading && <DelayedSpinner />}</span>;
}

/** The Analytics heading: the title, then one row that sets the period and the workflow for the whole page and holds Export. */
export function AnalyticsToolbar({ range, shown = range, reading = false, today, onRange, workflows, workflow, onWorkflow, exportButton }: {
  range: ActivityDateRange; today: string;
  /** The period of the report on screen, when it is still an earlier one than the chosen range. */
  shown?: ActivityDateRange; /** A read for the chosen period is in flight. */ reading?: boolean; onRange: (range: ActivityDateRange) => void;
  workflows: readonly AnalyticsWorkflow[]; workflow: string; onWorkflow: (id: string) => void; exportButton: ReactNode;
}) {
  const quick = QUICK.find(option => { const candidate = quickRange(option.value, today); return candidate.from === range.from && candidate.to === range.to; })?.value;
  return <>
    <PageHeading title="Analytics" description="Run results and time saved over a period." />
    <div className="ds-toolbar-row mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <SegmentedChoice hideLabel label="Report period" value={(quick ?? "") as Quick} options={QUICK} onChange={value => onRange(quickRange(value, today))} />
      {isActivityCalendarDate(shown.from) && isActivityCalendarDate(shown.to) && shown.from <= shown.to && <span className="flex items-center gap-2"><span className="flex items-center gap-1">
        <IconButton size="xs" label="Previous period" icon={<ChevronLeft aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, -1))} />
        <span data-analytics-period className="text-control tabular-nums text-ui-primary">{analyticsPeriodLabel(shown)}</span>
        <IconButton size="xs" label="Next period" disabled={range.to >= today} icon={<ChevronRight aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, 1))} />
      </span><ReadingSpinner reading={reading} /></span>}
      <span className="ml-auto flex items-center gap-2"><DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="ds-filter-trigger" iconAfter={<ChevronDown aria-hidden className="size-3.5 text-ui-muted" />}>{workflow === "all" ? "All workflows" : workflows.find(row => row.id === workflow)?.label}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]"><DropdownMenuRadioGroup value={workflow} onValueChange={onWorkflow}>
          <DropdownMenuRadioItem value="all">All workflows</DropdownMenuRadioItem><DropdownMenuSeparator />
          {workflows.map(row => <DropdownMenuRadioItem key={row.id} value={row.id}>{row.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>{exportButton}</span>
    </div>
  </>;
}

/** One figure of the Runs card: a label, the number, and a quiet note beside it. A figure with a status doubles as the chart's legend. */
function Figure({ label, status, value, note, onOpen }: { label: string; status?: DsStatus; value: string; note?: string; onOpen?: () => void }) {
  const number = <span className={`${dsText.display} tabular-nums text-ui-primary`}>{value}</span>;
  return <div className="min-w-0">
    <dt className="flex items-center gap-2 truncate text-body text-ui-secondary">{status && <StatusDot status={status} />}{label}</dt>
    <dd className="m-0 flex items-baseline gap-2">
      {onOpen ? <button type="button" aria-label={`Open ${label.toLowerCase()} runs`} className="cursor-pointer rounded-sm border-0 bg-transparent p-0 underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ds-accent)]" onClick={onOpen}>{number}</button> : number}
      {note && <span className="truncate text-body tabular-nums text-ui-muted">{note}</span>}
    </dd>
  </div>;
}

/** The Analytics body: Runs with its key figures, Workflows with a finished run, and the assistant's use, on served data. */
export function AnalyticsSections({ data, range, workflow, onOpenRuns, openRunsLocked = false }: {
  data: AnalyticsData; range: ActivityDateRange; workflow: string;
  onOpenRuns?: (metric: "completed" | "failed" | "outstanding", workflowId?: string) => void;
  /** Keeps the run links in place but inert, while the report on screen waits to be replaced. */
  openRunsLocked?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const shown = data.workflows.filter(row => workflow === "all" || row.id === workflow);
  const active = shown.filter(row => finished(row) > 0);
  const buckets = analyticsBuckets(range, shown);
  const totals = { done: shown.reduce((n, r) => n + r.done, 0), failed: shown.reduce((n, r) => n + r.failed, 0), attention: shown.reduce((n, r) => n + r.attention, 0) };
  const total = finished(totals);
  const days = buckets.map(bucket => ({ label: bucket.label, date: bucket.date }));
  const series = OUTCOMES.map(outcome => ({ id: outcome.key, label: outcome.label, status: outcome.status, color: outcome.color, values: buckets.map(bucket => bucket[outcome.key]) }));
  const typical = workflow === "all" ? (total === 0 ? null : data.typicalSeconds) : shown[0] ? rowTypicalSeconds(shown[0]) : null;
  const messages = bucketCounts(buckets, data.assistant.messages), proposed = bucketCounts(buckets, data.assistant.actions.map(row => ({ date: row.date, count: row.proposed })));
  const messageTotal = messages.reduce((n, value) => n + value, 0), proposedTotal = proposed.reduce((n, value) => n + value, 0);
  const noun = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const opens = (metric: "completed" | "failed" | "outstanding", id?: string) => onOpenRuns && !openRunsLocked ? () => onOpenRuns(metric, id) : undefined;
  const scope = workflow === "all" ? undefined : workflow;
  /** Half-width charts have no room for "Sun 20" seven times; the weekday alone names the day. */
  const smallDays = days.length <= 7 ? days.map(day => ({ ...day, label: day.label.split(" ")[0] ?? day.label })) : days;
  return <div className="ds-body-stack mt-4">
    <section aria-label="Runs">
      <StackedBars label="Runs per day" days={days} series={series} unit={["run", "runs"]}
        header={<dl className="m-0 mb-6 grid grid-cols-5 gap-4">
          <Figure label="Runs" value={String(total)} note={workflow === "all" && data.running > 0 ? `${data.running} open now` : undefined} />
          <Figure label="Done" status="verifiedDone" value={String(totals.done)} note={share(totals.done, total)} />
          <Figure label="Failed" status="failed" value={String(totals.failed)} note={share(totals.failed, total)} onOpen={totals.failed ? opens("failed", scope) : undefined} />
          <Figure label="Needs attention" status="waiting" value={String(totals.attention)} note={share(totals.attention, total)} onOpen={totals.attention ? opens("outstanding", scope) : undefined} />
          <Figure label="Typical time" value={analyticsClock(typical)} />
        </dl>} />
    </section>
    <BodySection title="Workflows">
      {active.length === 0 ? <p className="m-0 text-body text-ui-secondary">No finished runs in this period</p> :
      <div className="ds-table-list-frame ds-usage-table"><table aria-label="Workflows" className="table-fixed">
        <colgroup><col className="w-10" /><col /><col className="w-[72px]" /><col className="w-[168px]" /><col className="w-[72px]" /><col className="w-[72px]" /><col className="w-[120px]" /></colgroup>
        <thead><tr><th scope="col" className="ds-usage-chevron"><span className="sr-only">Details</span></th><th scope="col" className="!pl-0">Workflow</th><th scope="col" className={NUMBER}>Runs</th><th scope="col">Result</th><th scope="col" className={NUMBER}>Done</th><th scope="col" className={NUMBER}>Failed</th><th scope="col" className={NUMBER}>Typical time</th></tr></thead>
        <tbody>{active.map(row => {
          const isOpen = open.has(row.id), runs = finished(row);
          const details: readonly { label: string; values: readonly (readonly [string, string])[] }[] = [
            { label: "Runs", values: OUTCOMES.map(outcome => [outcome.label, `${row[outcome.key]} · ${share(row[outcome.key], runs)}`] as const) },
            ...(row.failedAt.length === 0 ? [] : [{ label: "Failed at", values: row.failedAt.map(step => [step.label, String(step.runs)] as const) }]),
          ];
          const cols = Math.max(...details.map(detail => detail.values.length));
          return <Fragment key={row.id}>
            <tr className={`cursor-pointer ${isOpen ? "!border-b-0" : ""}`} data-open={isOpen || undefined} onClick={() => toggle(row.id)}>
              <td className="ds-usage-chevron"><IconButton size="xs" label={`${isOpen ? "Hide" : "Show"} ${row.label} details`} aria-expanded={isOpen} icon={<ChevronRight aria-hidden className={`size-5 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} />} onClick={event => { event.stopPropagation(); toggle(row.id); }} /></td>
              <td className="!pl-0">{row.label}</td><td className={NUMBER}>{runs}</td>
              <td><span aria-hidden className="flex h-1.5 gap-0.5">{OUTCOMES.map(outcome => row[outcome.key] > 0 && <span key={outcome.key} className="h-full min-w-1 rounded-full" style={{ flexGrow: row[outcome.key], flexBasis: 0, background: outcome.color }} />)}</span></td>
              <td className={NUMBER}>{share(row.done, runs)}</td><td className={`${NUMBER} ${row.failed ? "text-ui-danger" : "text-ui-muted"}`}>{row.failed}</td><td className={NUMBER}>{analyticsClock(rowTypicalSeconds(row))}</td>
            </tr>
            {isOpen && <tr data-open><td /><td colSpan={6} className="!h-auto !pl-0 !pt-1 !pb-4">
              <dl style={{ "--usage-cols": cols + 1 } as CSSProperties}>
                {details.map(detail => <Fragment key={detail.label}><dt>{detail.label}</dt>{detail.values.map(([name, figure]) => <dd key={name}>{name} <span className="tabular-nums">{figure}</span></dd>)}{Array.from({ length: cols - detail.values.length }, (_, index) => <dd key={index} aria-hidden />)}</Fragment>)}
              </dl>
              {onOpenRuns && <Button variant="ghost" size="sm" className="mt-3" disabled={openRunsLocked} iconAfter={<ArrowUpRight aria-hidden className={dsIcon.md} />} onClick={() => onOpenRuns(row.failed ? "failed" : "completed", row.id)}>Open runs</Button>}
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>}
    </BodySection>
    <BodySection title="Assistant">
      {messageTotal + proposedTotal === 0 ? <p className="m-0 text-body text-ui-secondary">No assistant use in this period</p> :
      <div className="grid grid-cols-2 gap-3">
        <SmallLine label="Messages per day" name="Messages" days={smallDays} values={messages} summary={index => noun(messages[index] ?? 0, "message", "messages")} header={<ChartHeading label="Messages" value={String(messageTotal)} />} />
        <SmallLine label="Proposed actions per day" name="Proposed" days={smallDays} values={proposed} summary={index => noun(proposed[index] ?? 0, "action", "actions")} header={<ChartHeading label="Proposed actions" value={String(proposedTotal)} />} />
      </div>}
    </BodySection>
  </div>;
}
