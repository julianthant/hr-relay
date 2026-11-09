import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { RunList, RunListRow } from "../../run-start/run-list.js";
import { BodySection, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, PageHeading, SegmentedChoice, dsIcon } from "../../../ds/ui.js";
import { KeyFigures, RunsPerDayChart, TimeLines } from "./status-mock-charts.js";
import { STATUS_MOCK_ANALYTICS, STATUS_MOCK_OUTCOMES, type StatusMockCounts } from "./status-mock-model.js";

const PERIODS = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }] as const;
const CUSTOM = ["Choose dates…", "This month", "Last month", "Year to date"] as const;
const LINE_COLORS = ["var(--ui-info)", "#8b74f0", "var(--ui-secondary)"] as const;
const CARD = "rounded-[var(--ds-row-radius)] border border-ui-stroke bg-[var(--ds-card-bg)] px-[var(--ds-row-pad-x)]";
const NUMBER = "!text-right tabular-nums";

const sum = (rows: readonly StatusMockCounts[]): StatusMockCounts => ({ done: rows.reduce((n, r) => n + r.done, 0), failed: rows.reduce((n, r) => n + r.failed, 0), attention: rows.reduce((n, r) => n + r.attention, 0) });
const finished = (row: StatusMockCounts) => STATUS_MOCK_OUTCOMES.reduce((n, outcome) => n + row[outcome.key], 0);
const counts = ([done, failed, attention]: readonly number[]): StatusMockCounts => ({ done: done ?? 0, failed: failed ?? 0, attention: attention ?? 0 });

/** Analytics for an HR operator: a toolbar, then Runs, Workflows, Time and Why runs failed as sections of cards. A puts the key figures under the chart, B a slim row of them above it. */
export function StatusMockAnalytics({ variant }: { variant: "a" | "b" }) {
  const data = STATUS_MOCK_ANALYTICS;
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("7d");
  const [workflow, setWorkflow] = useState("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(["emergency-contact"]));
  const shown = data.workflows.filter(row => workflow === "all" || row.id === workflow);
  const rows = shown.map(row => ({ ...row, ...sum(row.byDay.map(counts)) }));
  const totals = sum(rows);
  const days = data.dayLabels.map((label, index) => ({ label, ...sum(shown.map(row => counts(row.byDay[index] ?? [])))}));
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const figures = <KeyFigures totals={totals} inline={variant === "b"} />;
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
        <div className={`${CARD} py-4`}>
          <div className="mb-4 flex items-center justify-between gap-3"><span className="text-[13px] leading-[18px]">{data.period}</span>
            <span className="flex items-center gap-1"><IconButton size="xs" label="Previous period" icon={<ChevronLeft aria-hidden className={dsIcon.md} />} /><IconButton size="xs" label="Next period" icon={<ChevronRight aria-hidden className={dsIcon.md} />} /></span></div>
          {variant === "b" && <div className="mb-5">{figures}</div>}
          <RunsPerDayChart days={days} height={variant === "b" ? 176 : 160} />
          {variant === "a" && <div className="mt-4">{figures}</div>}
        </div>
      </BodySection>
      <BodySection title="Workflows" description="Open a row to see what went wrong.">
        <div className="ds-table-list-frame"><table aria-label="Workflows">
          <thead><tr><th scope="col" className="w-10 !pr-0"><span className="sr-only">Details</span></th><th scope="col" className="!pl-0">Workflow</th><th scope="col" className={NUMBER}>Runs</th><th scope="col" className={NUMBER}>Done</th><th scope="col" className={NUMBER}>Failed</th><th scope="col" className={NUMBER}>Typical time</th></tr></thead>
          <tbody>{rows.map(row => <Fragment key={row.id}>
            <tr className={open.has(row.id) ? "!border-b-0" : undefined}>
              <td className="!pr-0"><IconButton size="xs" label={`${open.has(row.id) ? "Hide" : "Show"} ${row.label} details`} aria-expanded={open.has(row.id)} icon={<ChevronRight aria-hidden className={`${dsIcon.md} transition-transform motion-reduce:transition-none ${open.has(row.id) ? "rotate-90" : ""}`} />} onClick={() => toggle(row.id)} /></td>
              <td className="!pl-0">{row.label}</td><td className={NUMBER}>{finished(row)}</td><td className={NUMBER}>{Math.round(row.done / finished(row) * 100)}%</td><td className={`${NUMBER} ${row.failed ? "text-ui-danger" : ""}`}>{row.failed}</td><td className={NUMBER}>{row.time}</td>
            </tr>
            {open.has(row.id) && <tr><td /><td colSpan={5} className="!h-auto !pl-0 !pt-0"><ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] leading-[18px] text-ui-secondary">{row.lines.map(line => <li key={line}>{line}</li>)}</ul></td></tr>}
          </Fragment>)}</tbody>
        </table></div>
      </BodySection>
      <BodySection title="Time" description="How long finished runs take.">
        <div className={`${CARD} py-4`}>
          <p className="m-0 mb-5 flex items-baseline gap-2"><span className="text-[28px] font-normal leading-9 tabular-nums">{rows.length === 1 ? rows[0]?.time : data.typicalTime}</span><span className="text-[13px] text-ui-muted">typical</span></p>
          <TimeLines days={data.dayLabels} series={rows.map(row => ({ id: row.id, label: row.label, color: LINE_COLORS[data.workflows.findIndex(item => item.id === row.id)] ?? LINE_COLORS[2], seconds: row.seconds }))} />
        </div>
      </BodySection>
      <BodySection title="Why runs failed" description="Failed runs in this period.">
        <RunList label="Why runs failed">{data.reasons.map(reason => <RunListRow key={reason.label} title={reason.label} description={reason.workflow}><span className="text-[13px] tabular-nums">{reason.runs}</span></RunListRow>)}</RunList>
      </BodySection>
    </div>
  </section>;
}
