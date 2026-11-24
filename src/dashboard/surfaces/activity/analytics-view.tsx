import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { BodySection, Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, PageHeading, RankedList, SegmentedChoice, StatusDot, dsIcon, dsText, type DsStatus } from "../../ds/ui.js";
import { ChartHeading, KeyFigures, SmallLine, StackedBars } from "./analytics-charts.js";
import type { ActivityDateRange } from "./activity-model.js";
import { analyticsBuckets, analyticsClock, analyticsPeriodLabel, bucketCounts, finished, rankedTimes, rowTypicalSeconds, shiftDate, shiftRange, type AnalyticsData, type AnalyticsWorkflow } from "./analytics-model.js";

const QUICK = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }] as const;
type Quick = (typeof QUICK)[number]["value"];
const quickRange = (quick: Quick, today: string): ActivityDateRange => ({ from: shiftDate(today, 1 - Number.parseInt(quick, 10)), to: today });
const NUMBER = "!text-right tabular-nums";
const OUTCOMES: readonly { key: "done" | "failed" | "attention"; label: string; status: DsStatus; color: string }[] = [
  { key: "done", label: "Done", status: "verifiedDone", color: "var(--ds-status-verified-done-mark)" },
  { key: "failed", label: "Failed", status: "failed", color: "var(--ds-status-failed-mark)" },
  { key: "attention", label: "Needs attention", status: "waiting", color: "var(--ds-info-solid-bg)" },
];
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

/** Runs, Workflows, Time, and the assistant's Messages, Tools used and Actions, for the selected period, on served data. */
export function AnalyticsSections({ data, range, workflow, onRange, onOpenRuns, openRunsLocked = false }: {
  data: AnalyticsData; range: ActivityDateRange; workflow: string; onRange: (range: ActivityDateRange) => void; onOpenRuns?: (workflowId: string) => void;
  /** Keeps Open runs in place but inert, while the report on screen waits to be replaced. */
  openRunsLocked?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const shown = data.workflows.filter(row => workflow === "all" || row.id === workflow);
  const buckets = analyticsBuckets(range, shown);
  const totals = sum(shown);
  const days = buckets.map(bucket => ({ label: bucket.label, date: bucket.date }));
  const series = OUTCOMES.map(outcome => ({ id: outcome.key, label: outcome.label, status: outcome.status, color: outcome.color, values: buckets.map(bucket => bucket[outcome.key]) }));
  const ranked = rankedTimes(shown);
  const typical = workflow === "all" ? (finished(totals) === 0 ? null : data.typicalSeconds) : shown[0] ? rowTypicalSeconds(shown[0]) : null;
  const messages = bucketCounts(buckets, data.assistant.messages), proposed = bucketCounts(buckets, data.assistant.actions.map(row => ({ date: row.date, count: row.proposed })));
  const messageTotal = messages.reduce((n, value) => n + value, 0), proposedTotal = proposed.reduce((n, value) => n + value, 0);
  const noun = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="ds-body-stack mt-2">
    <BodySection title="Runs" description={`${noun(finished(totals), "run", "runs")} in this period${workflow === "all" ? ` · ${data.running} open now` : ""}`}>
      <StackedBars label="Runs per day" days={days} series={series} unit={["run", "runs"]}
        header={<div className="mb-4 flex items-center justify-between gap-3"><span className="text-control">{analyticsPeriodLabel(range)}</span>
          <span className="flex items-center gap-1"><IconButton size="xs" label="Previous period" icon={<ChevronLeft aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, -1))} /><IconButton size="xs" label="Next period" icon={<ChevronRight aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, 1))} /></span></div>}
        footer={<div className="mt-4"><KeyFigures items={series.map(line => ({ label: line.label, status: line.status, count: line.values.reduce((n, value) => n + value, 0) }))} /></div>} />
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
            { label: "Outcome", values: [["Done", percent(row.done)], ["Failed", percent(row.failed)], ["Needs attention", percent(row.attention)]] },
            ...(row.failedAt.length === 0 ? [] : [{ label: "Failed at", values: row.failedAt.map(step => [step.label, String(step.runs)] as const) }]),
          ];
          const cols = Math.max(...details.map(detail => detail.values.length));
          return <Fragment key={row.id}>
            <tr className={`cursor-pointer ${isOpen ? "!border-b-0" : ""}`} data-open={isOpen || undefined} onClick={() => toggle(row.id)}>
              <td className="ds-usage-chevron"><IconButton size="xs" label={`${isOpen ? "Hide" : "Show"} ${row.label} details`} aria-expanded={isOpen} icon={<ChevronRight aria-hidden className={`size-5 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} />} onClick={event => { event.stopPropagation(); toggle(row.id); }} /></td>
              <td className="!pl-0">{row.label}</td><td className={NUMBER}>{total}</td><td className={NUMBER}>{percent(row.done)}</td><td className={`${NUMBER} ${row.failed ? "text-ui-danger" : ""}`}>{row.failed}</td><td className={NUMBER}>{analyticsClock(rowTypicalSeconds(row))}</td>
            </tr>
            {isOpen && <tr data-open><td /><td colSpan={5} className="!h-auto !pl-0 !pt-1 !pb-4">
              <dl style={{ "--usage-cols": cols + 1 } as CSSProperties}>
                {details.map(detail => <Fragment key={detail.label}><dt>{detail.label}</dt>{detail.values.map(([name, figure]) => <dd key={name}>{name} <span className="tabular-nums">{figure}</span></dd>)}{Array.from({ length: cols - detail.values.length }, (_, index) => <dd key={index} aria-hidden />)}</Fragment>)}
              </dl>
              {onOpenRuns && <Button variant="ghost" size="sm" className="mt-3" disabled={openRunsLocked} iconAfter={<ArrowUpRight aria-hidden className={dsIcon.md} />} onClick={() => onOpenRuns(row.id)}>Open runs</Button>}
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>}
    </BodySection>
    {typical !== null && <BodySection title="Time" description="How long finished runs take.">
      <ChartHeading label="Typical time" value={analyticsClock(typical)} />
      <RankedList className="ds-analytics-ranked" label="Typical time per workflow" disabled onReorder={() => {}} items={ranked.map(row => ({ id: row.id, label: row.label,
        content: <span className="flex min-w-0 items-center gap-3">
          <span className="w-44 shrink-0 truncate">{row.label}</span>
          <span aria-hidden className="h-1 min-w-0 flex-1 rounded-full bg-ui-stroke"><span className="block h-full rounded-full bg-ui-muted" style={{ width: `${row.share * 100}%` }} /></span>
          <span className={`w-20 shrink-0 text-right tabular-nums`}>{analyticsClock(row.seconds)}</span>
        </span> }))} />
    </BodySection>}
    <BodySection title="Messages" description="Messages sent to the assistant each day.">
      {messageTotal === 0 ? <p className="m-0 text-body text-ui-secondary">No messages in this period</p> :
      <SmallLine label="Messages per day" name="Messages" days={days} values={messages} summary={index => noun(messages[index] ?? 0, "message", "messages")} header={<ChartHeading label="Messages" value={String(messageTotal)} />} />}
    </BodySection>
    <BodySection title="Actions" description="Actions the assistant proposed each day.">
      {proposedTotal === 0 ? <p className="m-0 text-body text-ui-secondary">No actions proposed in this period</p> :
      <SmallLine label="Proposed actions per day" name="Proposed" days={days} values={proposed} summary={index => noun(proposed[index] ?? 0, "action", "actions")} header={<ChartHeading label="Proposed actions" value={String(proposedTotal)} />} />}
    </BodySection>
  </div>;
}

const share = (count: number, total: number) => total === 0 ? "—" : `${Math.round(count / total * 100)}%`;

/** Proposed Analytics heading (#752): the title, then one row that sets the period and the workflow for the whole page and holds Export. */
export function AnalyticsRedesignHeading({ range, today, onRange, workflows, workflow, onWorkflow, exportButton }: {
  range: ActivityDateRange; today: string; onRange: (range: ActivityDateRange) => void;
  workflows: readonly AnalyticsWorkflow[]; workflow: string; onWorkflow: (id: string) => void; exportButton: ReactNode;
}) {
  const quick = QUICK.find(option => { const candidate = quickRange(option.value, today); return candidate.from === range.from && candidate.to === range.to; })?.value;
  return <>
    <PageHeading title="Analytics" />
    <div className="ds-toolbar-row mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <SegmentedChoice hideLabel label="Report period" value={(quick ?? "") as Quick} options={QUICK} onChange={value => onRange(quickRange(value, today))} />
      <span className="flex items-center gap-1">
        <IconButton size="xs" label="Previous period" icon={<ChevronLeft aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, -1))} />
        <span className="text-control tabular-nums text-ui-primary">{analyticsPeriodLabel(range)}</span>
        <IconButton size="xs" label="Next period" disabled={range.to >= today} icon={<ChevronRight aria-hidden className={dsIcon.md} />} onClick={() => onRange(shiftRange(range, 1))} />
      </span>
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

/** Proposed Analytics body (#752): Runs with its key figures, Workflows with a finished run, and the assistant's use, on served data. */
export function AnalyticsRedesignSections({ data, range, workflow, onOpenRuns, openRunsLocked = false }: {
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
