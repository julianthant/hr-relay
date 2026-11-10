import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState, type CSSProperties } from "react";
import { RunList, RunListRow } from "../../run-start/run-list.js";
import { BodySection, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, PageHeading, SegmentedChoice, dsIcon } from "../../../ds/ui.js";
import { ChartHeading, KeyFigures, LineChart, StackedBars, clock } from "./status-mock-charts.js";
import { analyticsDays } from "./status-mock-assistant-data.js";
import { STATUS_MOCK_ANALYTICS, STATUS_MOCK_OUTCOMES, type StatusMockCounts } from "./status-mock-model.js";

const PERIODS = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }] as const;
const CUSTOM = ["Choose dates…", "This month", "Last month", "Year to date"] as const;
const NUMBER = "!text-right tabular-nums";

const sum = (rows: readonly StatusMockCounts[]): StatusMockCounts => ({ done: rows.reduce((n, r) => n + r.done, 0), failed: rows.reduce((n, r) => n + r.failed, 0), attention: rows.reduce((n, r) => n + r.attention, 0) });
const finished = (row: StatusMockCounts) => STATUS_MOCK_OUTCOMES.reduce((n, outcome) => n + row[outcome.key], 0);
const counts = ([done, failed, attention]: readonly number[]): StatusMockCounts => ({ done: done ?? 0, failed: failed ?? 0, attention: attention ?? 0 });

/** Analytics for an HR operator: a toolbar, then Runs, Workflows, Time and Why runs failed as sections of cards. A puts the key figures under the chart, B a slim row of them above it. */
export function StatusMockAnalytics({ variant, onOpenWorkflow }: { variant: "a" | "b"; onOpenWorkflow?: (workflowId: string) => void }) {
  const data = STATUS_MOCK_ANALYTICS;
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("7d");
  const [workflow, setWorkflow] = useState("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(["emergency-contact"]));
  const shown = data.workflows.filter(row => workflow === "all" || row.id === workflow);
  const rows = shown.map(row => ({ ...row, ...sum(row.byDay.map(counts)) }));
  const totals = sum(rows);
  const days = analyticsDays(7).map((day, index) => ({ ...day, ...sum(shown.map(row => counts(row.byDay[index] ?? []))) }));
  const outcomes = STATUS_MOCK_OUTCOMES.map(outcome => ({ id: outcome.key, label: outcome.label, color: outcome.color, values: days.map(day => day[outcome.key]) }));
  const timeDays = analyticsDays(7);
  const timeSeries = rows.map(row => ({ id: row.id, label: row.label, color: `var(--chart-${data.workflows.findIndex(item => item.id === row.id) + 1})`, values: row.seconds }));
  const top = Math.ceil(Math.max(...timeSeries.flatMap(line => line.values)) / 60) * 60;
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const figures = <KeyFigures items={outcomes.map(line => ({ label: line.label, color: line.color, count: line.values.reduce((n, value) => n + value, 0) }))} inline={variant === "b"} />;
  return <section aria-label="Analytics report" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Analytics" description="How your workflows are going." />
    <div className="ds-toolbar-row flex flex-wrap items-center gap-2">
      <SegmentedChoice hideLabel label="Report period" value={period} options={PERIODS} onChange={setPeriod} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="ds-filter-trigger" iconAfter={<ChevronDown aria-hidden className="size-3.5 text-ui-muted" />}>Custom…</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[200px]">
          <DropdownMenuItem>{CUSTOM[0]}</DropdownMenuItem><DropdownMenuSeparator />{CUSTOM.slice(1).map(label => <DropdownMenuItem key={label}>{label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="ds-filter-trigger" iconAfter={<ChevronDown aria-hidden className="size-3.5 text-ui-muted" />}>{workflow === "all" ? "By workflow" : data.workflows.find(row => row.id === workflow)?.label}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[220px]"><DropdownMenuRadioGroup value={workflow} onValueChange={setWorkflow}>
          <DropdownMenuRadioItem value="all">All workflows</DropdownMenuRadioItem><DropdownMenuSeparator />
          {data.workflows.map(row => <DropdownMenuRadioItem key={row.id} value={row.id}>{row.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
      <span className="ml-auto"><Button variant="secondary">Export</Button></span>
    </div>
    <div className="ds-body-stack mt-2">
      <BodySection title="Runs" description={`${finished(totals)} finished runs${workflow === "all" ? ` · ${data.running} still running` : ""}`}>
        <StackedBars label="Runs per day" days={days} series={outcomes} unit={["run", "runs"]} height={variant === "b" ? 176 : 160}
          header={<><div className="mb-4 flex items-center justify-between gap-3"><span className="text-[13px] leading-[18px]">{data.period}</span>
            <span className="flex items-center gap-1"><IconButton size="xs" label="Previous period" icon={<ChevronLeft aria-hidden className={dsIcon.md} />} /><IconButton size="xs" label="Next period" icon={<ChevronRight aria-hidden className={dsIcon.md} />} /></span></div>
            {variant === "b" && <div className="mb-5">{figures}</div>}</>}
          footer={variant === "a" ? <div className="mt-4">{figures}</div> : undefined} />
      </BodySection>
      <BodySection title="Workflows" description="Open a row to see what went wrong.">
        <div className="ds-table-list-frame ds-usage-table"><table aria-label="Workflows">
          <thead><tr><th scope="col" className="ds-usage-chevron"><span className="sr-only">Details</span></th><th scope="col" className="!pl-0">Workflow</th><th scope="col" className={NUMBER}>Runs</th><th scope="col" className={NUMBER}>Done</th><th scope="col" className={NUMBER}>Failed</th><th scope="col" className={NUMBER}>Typical time</th></tr></thead>
          <tbody>{rows.map(row => {
            const isOpen = open.has(row.id), total = finished(row), failedAt: readonly (readonly [string, number])[] = row.failedAt;
            const percent = (n: number) => `${Math.round(n / total * 100)}%`;
            const details: readonly { label: string; values: readonly (readonly [string, string])[] }[] = [
              { label: "Outcome", values: [["Done", percent(row.done)], ["Failed", percent(row.failed)], ["Waiting", percent(row.attention)]] },
              ...(failedAt.length === 0 ? [] : [{ label: "Failed at", values: failedAt.map(([step, n]) => [step, String(n)] as const) }]),
            ];
            const cols = Math.max(...details.map(detail => detail.values.length));
            return <Fragment key={row.id}>
              <tr className={`cursor-pointer ${isOpen ? "!border-b-0" : ""}`} data-open={isOpen || undefined} onClick={() => toggle(row.id)}>
                <td className="ds-usage-chevron"><IconButton size="xs" label={`${isOpen ? "Hide" : "Show"} ${row.label} details`} aria-expanded={isOpen} icon={<ChevronRight aria-hidden className={`size-5 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} />} onClick={event => { event.stopPropagation(); toggle(row.id); }} /></td>
                <td className="!pl-0">{row.label}</td><td className={NUMBER}>{total}</td><td className={NUMBER}>{percent(row.done)}</td><td className={`${NUMBER} ${row.failed ? "text-ui-danger" : ""}`}>{row.failed}</td><td className={NUMBER}>{row.time}</td>
              </tr>
              {isOpen && <tr data-open><td /><td colSpan={5} className="!h-auto !pl-0 !pt-1 !pb-4">
                <dl style={{ "--usage-cols": cols + 1 } as CSSProperties}>
                  {details.map(detail => <Fragment key={detail.label}><dt>{detail.label}</dt>{detail.values.map(([name, figure]) => <dd key={name}>{name} <span className="tabular-nums">{figure}</span></dd>)}{Array.from({ length: cols - detail.values.length }, (_, index) => <dd key={index} aria-hidden />)}</Fragment>)}
                </dl>
                {onOpenWorkflow && <button type="button" className="mt-4 inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] font-normal leading-[18px] text-ui-primary hover:underline" onClick={() => onOpenWorkflow(row.id)}>Open runs <ArrowUpRight aria-hidden className={dsIcon.md} /></button>}
              </td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>
      </BodySection>
      <BodySection title="Time" description="How long finished runs take.">
        <LineChart label="Average time per day" days={timeDays} series={timeSeries} ticks={[top, top / 2, 0].map(value => ({ value, label: value === 0 ? "0" : `${value / 60}m` }))} top={top} format={clock}
          summary={index => `${clock(timeSeries.reduce((n, line) => n + (line.values[index] ?? 0), 0) / timeSeries.length)} average`}
          header={<ChartHeading label="Average time" value={rows.length === 1 ? rows[0]?.time ?? data.typicalTime : data.typicalTime} />} />
      </BodySection>
      <BodySection title="Why runs failed" description="Failed runs in this period.">
        <RunList label="Why runs failed">{data.reasons.map(reason => <RunListRow key={reason.label} title={reason.label} description={reason.workflow}><span className="text-[13px] tabular-nums">{reason.runs}</span></RunListRow>)}</RunList>
      </BodySection>
    </div>
  </section>;
}
