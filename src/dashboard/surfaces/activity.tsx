import { saveDownload } from "../lib/save-download.js";
import type { ActivityReportSelection } from "../../domain/dashboard/activity-selection.js";
import { observeAsyncResource } from "../state/async-resource.js";
/**
 * Ported from legacy hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e,
 * `src/dashboard/components/dev/rebuild-demo/DemoActivityReport.tsx` and
 * `demo-report-wire.ts` (the operator's rebuild-demo). Adapted to the served
 * `ActivityReportWire` — never linked at runtime (D93/D94).
 *
 * The Activity report (ref frontend-backend-integration §5 "Activity", §6.7, D180).
 *
 * ## THESIS — a paragraph, then the shape of it
 *
 * This is the one artifact in the product that leaves the operator's screen and
 * lands in front of a supervisor, which is exactly why it is built the opposite
 * way round from a status board: the honest counterweights come FIRST and are
 * not collapsible. Outstanding work sits IN the headline row rather than under
 * it, the error rate states its denominator on the tile, and every caveat is
 * one press away from the header — because a caveat that only exists in a
 * footnote on a page nobody scrolls is a caveat nobody read.
 *
 * ## Every total descends from the ONE projection — except one, which says so
 *
 * Nothing on this page counts anything. D81 and ref frontend-backend-integration §8 guard #4 name
 * Activity aggregates explicitly, so the server builds them inside the same
 * `run-queue-projection` that renders the Queue Panel and this component
 * renders the payload verbatim — the chart consumes its authoritative volume
 * series, so the browser never rebuilds intervals from the legacy day list.
 *
 * The write-ledger block is the ONE exception, ratified as such (D236, ref dashboard-surfaces
 * §10.1): it is a different authority, folded from the append-only ledger over
 * the same window and reported BESIDE these totals rather than derived from
 * them. It carries the seam in its own subtitle and in the ⓘ, because a second
 * authority the reader cannot see is one the reader assumes is the first.
 *
 * ## Durations, and warnings, report their misses
 *
 * D124's lesson was that a surface must never substitute `now` for a terminal
 * instant nobody recorded. An aggregate has the same duty at scale, so the
 * duration block states the measured count and the unmeasured count side by
 * side. A median over a denominator that quietly dropped its unknowns is the
 * kind of number that gets quoted in a meeting.
 *
 * The per-workflow table applies the same rule to warnings, which is why it has
 * an `Unread` column the demo does not: a finished run with no derived evidence
 * receipt has a warning set nobody has read, and adding it to `Read back` would
 * put "came back clean" on a supervisor's copy over a run nobody checked.
 *
 * ## What the demo has that this does not, and why nothing here approximates it
 *
 * The demo's report reads a fixture corpus of whole rows; this one reads an
 * aggregate wire. Its distinct-people axis now counts only declared durable
 * validated canonical identity evidence, and its workflow code comes from the registry;
 * neither is reconstructed from display rows. One demo element is absent by
 * ruling rather than by gap — the hours-saved tile, whose
 * only input would be an operator-entered minutes constant with no durable
 * home, is DROPPED (D239): a fabricated minutes figure on the one artifact that
 * leaves the operator's screen is the highest-consequence invented number in
 * the product. All three are RECORDED in `docs/findings/activity.md` rather
 * than approximated here. The write ledger (D236) and Export (D240) are served.
 *
 * The Who column is served, and served NARROW: the wire carries run ids and no
 * names, because a name is subject data on an artifact built to be exported.
 * The names are resolved here against the queue rows the shell already holds,
 * and a sampled run those rows do not cover announces itself by id rather than
 * by a name this surface would have to invent.
 */
import { CalendarDays,ChartNoAxesColumnIncreasing,ChevronDown,Download,Info,TriangleAlert } from "lucide-react";
import { RangeCalendar as HeroRangeCalendar } from "@heroui/react";
import { parseDate,type CalendarDate } from "@internationalized/date";
import { useCallback,useEffect,useLayoutEffect,useMemo,useState,useRef,useId,type ReactNode,type Ref } from "react";
import {
activityErrorRatePercent,
activityReportCaveats,
activityStatusRuns,
type ActivityReportWire,
} from "../../domain/dashboard/activity.js";
import { DashboardClientError } from "../client/errors.js";
import {
BulletList,
Button,
Card,
  CardBody,
  Disclosure,
  DsBodyScope,
  dsFocus,
  dsIcon,
dsSurface,
dsText,
MetaLine,
Popover,
PopoverContent,
PopoverTrigger,
Refusal,
SectionLabel,
Select,
Skeleton,
  StatusPill,
  Table,
  TakeoverFrame,
  TBody,
  TD,
  TH,
  THead,
  Tooltip,
  TooltipProvider,
  TR,
  Well,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useActivityClient as useDashboardClient } from "../state/activity-client.js";
import { failed,LOADING,type AsyncResource } from "../state/async-resource.js";
import {
ACTIVITY_DATE_PRESETS,
activityCompactRangeLabel,
activityPresetOf,
activityPresetRange,
activityRangeDraft,
applyActivityRangeDraft,
activityPeopleEvidenceItems,
activityPeopleNote,
activityRangeValue,
parseActivityRange,
resolveActivityWho,
type ActivityRangeDraft,
type QueueRowIdentity,
} from "./activity-model.js";
import { createActivityVolumeChartModel } from "./activity-chart-model.js";
import { fmtClock,plural } from "./format.js";
import { dsStatusOf,statusText,type QueueStatus } from "./status-model.js";

/* the range vocabulary lives in `activity-model.ts` — see the note there */

function calendarDate(value: string): CalendarDate | null {
  try { return parseDate(value); } catch { return null; }
}

function ActivityDateControl({ from, to, today, invalid, draft, onDraftChange, onApply, open, triggerRef, onOpenChange }: {
  from: string;
  to: string;
  today: string;
  invalid: boolean;
  draft: ActivityRangeDraft | null;
  onDraftChange: (value: ActivityRangeDraft) => void;
  onApply: () => void;
  open: boolean;
  triggerRef: Ref<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
}) {
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const start = draft?.from === null || draft === null ? null : calendarDate(draft.from);
  const end = draft?.to === null || draft === null ? null : calendarDate(draft.to);
  const draftResult = draft === null ? null : applyActivityRangeDraft(draft);
  const selected = draftResult?.state === "ready" && start !== null && end !== null;
  const appliedLabel = invalid ? "Invalid report span" : activityCompactRangeLabel({ from, to });
  const pendingAnchor = useRef(false);
  const changeOpen = (next: boolean) => {
    pendingAnchor.current = false;
    setYearPickerOpen(false);
    onOpenChange(next);
  };
  const noteCalendarActivation = (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest(".range-calendar__cell") === null) return;
    if (!pendingAnchor.current) {
      pendingAnchor.current = true;
      onDraftChange({ from: null, to: null });
    } else {
      pendingAnchor.current = false;
    }
  };
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button ref={triggerRef} size="toolbar" variant="secondary" aria-label={`Select report dates: ${appliedLabel}`} aria-expanded={open} aria-invalid={invalid || undefined} icon={<CalendarDays aria-hidden className={dsIcon.sm} />}>
        <span className="tabular-nums">{appliedLabel}</span><ChevronDown aria-hidden className={dsIcon.sm} />
      </Button>
    </PopoverTrigger>
    <PopoverContent title="Select report dates" hideTitle align="end" width="md" className="ds-date-popover activity-range-popover">
      <div onPointerDownCapture={event => { noteCalendarActivation(event.target); }} onKeyDownCapture={event => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) noteCalendarActivation(event.target);
      }}>
        <HeroRangeCalendar aria-label="Choose report date range" className="ds-hero-calendar activity-range-calendar" defaultFocusedValue={calendarDate(today)} isYearPickerOpen={yearPickerOpen} onYearPickerOpenChange={setYearPickerOpen} value={selected ? { start, end } : null} onChange={dates => {
          pendingAnchor.current = false;
          if (dates !== null) onDraftChange({ from: dates.start.toString(), to: dates.end.toString() });
        }}>
          <HeroRangeCalendar.Header>
            <HeroRangeCalendar.NavButton className="size-8 text-foreground" slot="previous" aria-label="Previous month" />
            <HeroRangeCalendar.YearPickerTrigger className="h-8 min-h-8 w-full justify-center">
              <HeroRangeCalendar.YearPickerTriggerHeading className="text-foreground" />
              <HeroRangeCalendar.YearPickerTriggerIndicator className="text-foreground" />
            </HeroRangeCalendar.YearPickerTrigger>
            <HeroRangeCalendar.NavButton className="size-8 text-foreground" slot="next" aria-label="Next month" />
          </HeroRangeCalendar.Header>
          <HeroRangeCalendar.Grid><HeroRangeCalendar.GridHeader>{day => <HeroRangeCalendar.HeaderCell>{day}</HeroRangeCalendar.HeaderCell>}</HeroRangeCalendar.GridHeader><HeroRangeCalendar.GridBody>{date => <HeroRangeCalendar.Cell date={date} className={date.toString() === today ? "activity-range-calendar-report-today" : undefined} />}</HeroRangeCalendar.GridBody></HeroRangeCalendar.Grid>
          {yearPickerOpen && <HeroRangeCalendar.YearPickerGrid><HeroRangeCalendar.YearPickerGridBody>{({ year }) => <HeroRangeCalendar.YearPickerCell year={year} />}</HeroRangeCalendar.YearPickerGridBody></HeroRangeCalendar.YearPickerGrid>}
        </HeroRangeCalendar>
      </div>
      <div className="mt-[var(--ds-space-base)] flex justify-end gap-[var(--ds-space-snug)] border-t border-[color:var(--ds-border)] pt-[var(--ds-space-base)]">
        <Button size="md" variant="secondary" onClick={() => changeOpen(false)}>Cancel</Button>
        <Button size="md" variant="primary" className="activity-range-apply" disabled={draftResult?.state !== "ready"} onClick={onApply}>Apply range</Button>
      </div>
    </PopoverContent>
  </Popover>;
}

function ms(value: number): string {
  if (value < 1000) return `${String(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${String(minutes)}m ${String(rest)}s`;
}

/**
 * Nonterminal statuses retain the established attention-first order.
 * Cancelling belongs beside Running until canonical settlement.
 */
const OUTSTANDING_ORDER: readonly QueueStatus[] = ["awaiting-approval", "blocked", "running", "cancelling", "queued"];

function statusRuns(report: ActivityReportWire, status: QueueStatus): number {
  return activityStatusRuns(report, status);
}

/**
 * One proportional row. The bar is a plain element sized from the share, so
 * the number and the bar can never disagree — they are the same value read
 * twice — and the row degrades to a legible label/number pair with no bar at
 * all when the total is zero.
 */
function ShareRow({
  label,
  runs,
  total,
  tone = "var(--ds-accent-mark)",
}: {
  label: ReactNode;
  runs: number;
  total: number;
  tone?: string;
}) {
  const share = total === 0 ? 0 : Math.round((runs / total) * 100);
  return (
    <TR>
      <TD>{label}</TD>
      <TD>
        <span
          aria-hidden
          className="block h-[var(--ds-space-snug)] rounded-[var(--ds-radius-sm)] bg-[color:var(--ds-surface-3)]"
        >
          <span
            className="block h-full rounded-[var(--ds-radius-sm)]"
            style={{ width: `${String(Math.max(share, runs > 0 ? 2 : 0))}%`, background: tone }}
          />
        </span>
      </TD>
      <TD numeric align="right">{runs}</TD>
      <TD numeric align="right">
        <span className="text-[color:var(--ds-fg-muted)]">{share}%</span>
      </TD>
    </TR>
  );
}

function ShareTable({
  label,
  total,
  rows,
}: {
  label: string;
  total: number;
  rows: readonly { key: string; label: ReactNode; runs: number; tone?: string }[];
}) {
  return (
    <div className="min-w-0">
      <SectionLabel className="mb-[var(--ds-space-snug)]">{label}</SectionLabel>
      <div className="overflow-x-auto">
        {/*
          Fixed columns, identical across every breakdown, so the tables read as
          one measure taken two ways rather than two tables that happen to be
          stacked — the bars line up down the page and the eye can compare a
          day's share with an outcome's without re-anchoring.
        */}
        <Table label={label} layout="fixed">
          <colgroup>
            <col />
            <col style={{ width: "40%" }} />
            <col style={{ width: "var(--ds-w-archive-duration)" }} />
            <col style={{ width: "var(--ds-w-archive-duration)" }} />
          </colgroup>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Share</TH>
              <TH align="right">Runs</TH>
              <TH align="right">%</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <ShareRow
                key={row.key}
                label={row.label}
                runs={row.runs}
                total={total}
                {...(row.tone === undefined ? {} : { tone: row.tone })}
              />
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * One CATEGORY block of the per-workflow table: a heading row, its workflows,
 * then its own subtotal — so one category reads as a block against another
 * instead of both being scattered through a flat list in run-count order.
 *
 * It is its own `<tbody>`, which is what lets a heading and a subtotal live
 * inside one table without breaking the column alignment the whole point rests
 * on. The grouping comes from each run's own served `registration.categoryId`
 * and the subtotal is the wire's OWN `categories[]` total, never a re-sum — so
 * the report cannot bin a workflow under a heading the product does not use,
 * and a block cannot disagree with the payload it was built from.
 */
/**
 * One workflow's cells beyond `Runs` / `Share`, straight off the wire.
 *
 * A subtotal row carries the same shape, summed by the SERVER's own category
 * total for `runs`; the status columns are added here from the rows that make
 * the block up, which is a re-presentation of numbers the payload already
 * agreed on rather than a second count of anything — the wire's own refinement
 * has already refused a payload whose rows and totals disagree.
 */
interface WorkflowCells {
  readBack: number;
  warnings: number;
  warningsUnknown: number;
  completed: number;
  failed: number;
  cancelled: number;
  partial: number;
  open: number;
}

const EMPTY_CELLS: WorkflowCells = {
  readBack: 0,
  warnings: 0,
  warningsUnknown: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  partial: 0,
  open: 0,
};

function cellsOf(workflow: ActivityReportWire["workflows"][number]): WorkflowCells {
  const { completion } = workflow;
  return {
    readBack: completion.readBack,
    warnings: completion.warnings,
    warningsUnknown: completion.warningsUnknown,
    completed: completion.readBack + completion.warnings + completion.warningsUnknown,
    failed: workflow.failed,
    cancelled: workflow.cancelled,
    partial: workflow.partial,
    open: workflow.open,
  };
}

function sumCells(rows: readonly WorkflowCells[]): WorkflowCells {
  return rows.reduce<WorkflowCells>((total, row) => ({
    readBack: total.readBack + row.readBack,
    warnings: total.warnings + row.warnings,
    warningsUnknown: total.warningsUnknown + row.warningsUnknown,
    completed: total.completed + row.completed,
    failed: total.failed + row.failed,
    cancelled: total.cancelled + row.cancelled,
    partial: total.partial + row.partial,
    open: total.open + row.open,
  }), EMPTY_CELLS);
}

function CategoryBody({
  label,
  reason,
  workflows,
  subtotalRuns,
  showSubtotal = true,
}: {
  label: string;
  /**
   * The wire's own words for an `unregistered` category. It rides BESIDE the
   * heading in sentence case rather than becoming the heading: `SectionLabel`
   * is a caps treatment, and a whole sentence shouted in caps — then repeated
   * with `— subtotal` welded onto the end — is unreadable at exactly the
   * moment the report has something unusual to say.
   */
  reason?: string;
  workflows: readonly {
    workflowId: string;
    label: ReactNode;
    registrationReason?: string;
    runs: number;
    cells: WorkflowCells;
  }[];
  subtotalRuns: number;
  showSubtotal?: boolean;
}) {
  return (
    <TBody>
      <TR className="h-auto">
        <TD colSpan={5} className="bg-[var(--ds-surface-2)] py-[var(--ds-space-tight)]">
          <span className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
            <span className={cn(dsText.meta, "shrink-0 font-medium text-[color:var(--ds-fg-secondary)]")}>{label}</span>
            <span className={cn(dsText.meta, "shrink-0 tabular-nums text-[color:var(--ds-fg-muted)]")}>
              {plural(workflows.length, "workflow")}
            </span>
            {reason !== undefined && (
              <span className={cn(dsText.micro, "min-w-0 break-words text-[color:var(--ds-fg-faint)]")}>{reason}</span>
            )}
          </span>
        </TD>
      </TR>
      {workflows.map((workflow) => (
        <WorkflowRow
          key={workflow.workflowId}
          label={workflow.label}
          runs={workflow.runs}
          cells={workflow.cells}
          registrationReason={workflow.registrationReason}
        />
      ))}
      {showSubtotal && <WorkflowRow
        label={`${label} — subtotal`}
        runs={subtotalRuns}
        cells={sumCells(workflows.map((workflow) => workflow.cells))}
        subtotal
      />}
    </TBody>
  );
}

function WorkflowRow({
  label,
  runs,
  cells,
  registrationReason,
  subtotal,
}: {
  label: ReactNode;
  runs: number;
  cells: WorkflowCells;
  registrationReason?: string;
  subtotal?: boolean;
}) {
  const cell = subtotal ? "font-semibold text-[color:var(--ds-fg)]" : undefined;
  const settlement = [
    cells.cancelled > 0 ? `${String(cells.cancelled)} cancelled` : undefined,
    cells.partial > 0 ? `${String(cells.partial)} partial` : undefined,
  ].filter((value): value is string => value !== undefined);
  return (
    <TR className={subtotal ? "bg-[var(--ds-surface-2)]" : undefined}>
      <TD className={cn("min-w-0", cell, subtotal ? undefined : "text-[color:var(--ds-fg)]")}>
        <details className="group min-w-0">
          <summary className={cn("flex cursor-pointer list-none items-baseline gap-[var(--ds-space-tight)] [&::-webkit-details-marker]:hidden", dsFocus)}>
            <ChevronDown aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)] transition-transform group-open:rotate-180")} />
            <span className="min-w-0 break-words">{label}</span>
            <span className="sr-only">Show workflow detail</span>
          </summary>
          <div className={cn(dsText.meta, "mt-[var(--ds-space-tight)] grid gap-[var(--ds-space-hair)] pl-[calc(var(--ds-h-sm)+var(--ds-space-tight))] text-[color:var(--ds-fg-muted)]")}>
            {registrationReason !== undefined && <p>{registrationReason}</p>}
            <p>{String(cells.readBack)} read back · {String(cells.warnings)} with warnings · {String(cells.warningsUnknown)} warning status unread</p>
            <p>{settlement.length === 0 ? "No cancelled or partial runs." : settlement.join(" · ")}</p>
          </div>
        </details>
      </TD>
      <TD align="right" className={cn("tabular-nums", cell)}>{cells.completed}</TD>
      <TD align="right" className={cn("tabular-nums", cell)}>{cells.open}</TD>
      <TD align="right" className={cn("tabular-nums", cell)}>{cells.failed}</TD>
      <TD align="right" className={cn("tabular-nums", cell)}>{runs}</TD>
    </TR>
  );
}

/**
 * The per-workflow table, grouped by the served category axis.
 *
 * The primary cells are the served status partition. Evidence and exceptional
 * terminal states remain in the row's native disclosure instead of being
 * misrepresented as completion, failure, or open work.
 */
function WorkflowsByCategory({ report }: { report: ActivityReportWire }) {
  const blocks = report.categories.map((entry) => {
    const category = entry.category;
    // The two arms are read separately rather than through a boolean, because a
    // boolean does not narrow the union and a cast would be this surface
    // asserting a shape the wire did not promise.
    //
    // The heading for the `unregistered` arm is the arm's OWN name — not an
    // invented word, and not the reason sentence, which travels beside it
    // verbatim. Nothing here derives a category from a workflow id.
    const label = category.state === "registered" ? category.categoryId : "unregistered";
    const workflows = report.workflows
      .filter((workflow) =>
        category.state === "registered"
          ? workflow.registration.state === "registered" && workflow.registration.categoryId === category.categoryId
          : workflow.registration.state === "unregistered",
      )
      .map((workflow) => ({
        workflowId: workflow.workflowId,
        label:
          workflow.registration.state === "registered"
            ? (
              <span className="inline-flex max-w-full min-w-0 items-baseline gap-[var(--ds-space-snug)]">
                <span className={cn(dsText.nums, dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                  {workflow.registration.code}
                </span>
                <span className="min-w-0 break-words">{workflow.registration.label}</span>
              </span>
            )
            : <span className="break-words text-[color:var(--ds-status-waiting-fg)]">{workflow.workflowId}</span>,
        ...(workflow.registration.state === "unregistered" ? { registrationReason: workflow.registration.reason } : {}),
        runs: workflow.runs,
        cells: cellsOf(workflow),
      }))
      .sort((a, b) => b.runs - a.runs);
    return {
      key: label,
      label,
      workflows,
      subtotalRuns: entry.runs,
      ...(category.state === "registered" ? {} : { reason: category.reason }),
    };
  });

  return (
    <div className="min-w-0">
      <h2 className={cn(dsText.title, "mb-[var(--ds-space-snug)] font-semibold text-[color:var(--ds-fg)]")}>Workflow outcomes</h2>
      <div className="overflow-x-auto rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]">
        <Table label="Activity by workflow, grouped by category" layout="fixed" className="activity-workflow-table min-w-[42rem]">
          <colgroup>
            <col style={{ width: "42%" }} />
            <col span={4} style={{ width: "calc(58% / 4)" }} />
          </colgroup>
          <THead>
            <TR>
              <TH className="normal-case tracking-normal">Workflow</TH>
              <TH align="right" className="normal-case tracking-normal">Completed</TH>
              <TH align="right" className="normal-case tracking-normal">Outstanding</TH>
              <TH align="right" className="normal-case tracking-normal">Failed</TH>
              <TH align="right" className="normal-case tracking-normal">Total runs</TH>
            </TR>
          </THead>
          {blocks.length === 0 ? <TBody><TR><TD colSpan={5} className="text-[color:var(--ds-fg-muted)]">No workflow runs in this range.</TD></TR></TBody> : blocks.map((block) => (
            <CategoryBody
              key={block.key}
              label={block.label}
              workflows={block.workflows}
              subtotalRuns={block.subtotalRuns}
              showSubtotal={block.workflows.length > 1}
              {...("reason" in block ? { reason: block.reason } : {})}
            />
          ))}
        </Table>
      </div>
    </div>
  );
}

/**
 * One outstanding STATE and its count.
 *
 * The state is the question ("how many are waiting on me") and the count is the
 * answer. DEVIATION from the demo, recorded in `docs/findings/activity.md`: the
 * demo's third column names the people behind each bucket and opens the full
 * list in a popover. The aggregate wire carries counts only — no run
 * identities — so the column is absent rather than empty.
 */
/**
 * One sampled run, resolved against the queue rows the shell already holds.
 *
 * The report wire carries run IDS and no names. That is deliberate — a name is
 * subject data and this artifact is built to be exported, so the redaction
 * posture for names on it is unsettled (`docs/findings/activity.md`) — and it
 * means the resolution happens HERE, against rows the client already loaded
 * for the day it is looking at.
 *
 * The report spans a RANGE and those rows are one DAY, so a sampled run is
 * routinely not among them. That is not a failure and it is not a gap to fill:
 * the run announces itself by id, which is a fact, rather than by a name this
 * surface would have to guess at from a workflow and a date.
 */
/**
 * One outstanding STATE, its count, and WHO is behind it.
 *
 * The state is the question ("how many are waiting on me"), the count is the
 * answer, and the names stay reachable one press away — a popover rather than
 * a spray, because they are a list you consult, not a list you scan.
 *
 * The sample is BOUNDED by the server at five, so the popover's heading says
 * how many of the bucket it is showing. A list captioned with the bucket's
 * full count while holding five entries would be the surface quietly claiming
 * the sample is the whole.
 */
function OutstandingRow({
  status,
  runs,
  sample,
  rows,
  report,
}: {
  status: QueueStatus;
  runs: number;
  sample: readonly string[];
  rows: readonly QueueRowIdentity[];
  report: ActivityReportWire;
}) {
  const who = sample.map((runId) => resolveActivityWho(runId, rows, report));
  const first = who[0];
  const beyondSample = runs - sample.length;
  return (
    <TR>
      <TD>
        <StatusPill status={dsStatusOf(status)} size="sm" />
      </TD>
      <TD align="right" numeric>
        {runs}
      </TD>
      <TD>
        <span className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          <span className={cn(dsText.meta, "min-w-0 truncate text-[color:var(--ds-fg-secondary)]")}>
            {first === undefined ? "—" : <WhoName who={first} />}
            {runs > 1 && ` +${String(runs - 1)}`}
          </span>
          {runs > 1 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="ml-auto shrink-0">
                  All {runs}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                title={statusText(dsStatusOf(status))}
                description={
                  beyondSample > 0
                    ? `${plural(sample.length, "run")} of ${String(runs)} — the report samples the first ${String(sample.length)}`
                    : plural(runs, "run")
                }
                width="lg"
                align="end"
              >
                <ul className="flex flex-col gap-[var(--ds-space-tight)]">
                  {who.map((entry) => (
                    <li key={entry.runId} className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
                      <span className={cn(dsText.body, "min-w-0 flex-1 truncate text-[color:var(--ds-fg)]")}>
                        <WhoName who={entry} />
                      </span>
                      {entry.workflowLabel !== undefined && (
                        <span className={cn(dsText.meta, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
                          {entry.workflowLabel}
                        </span>
                      )}
                      <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-faint)]")}>
                        {entry.traceId ?? entry.runId}
                      </span>
                    </li>
                  ))}
                </ul>
                {/*
                  The sample is the server's, not a slice taken here, so the
                  remainder is stated rather than silently dropped: a list that
                  stops at five under a heading reading "12 runs" is a list the
                  operator would read as complete.
                */}
                {beyondSample > 0 && (
                  <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
                    {plural(beyondSample, "further run")} in this state {beyondSample === 1 ? "is" : "are"} not sampled
                    on this report. The queue for each day holds them all.
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
        </span>
      </TD>
    </TR>
  );
}

/**
 * A name if the client holds the row, the run id if it does not — never a
 * label composed out of a workflow and a date, which would read exactly like
 * a real name and be one for nobody.
 */
function WhoName({ who }: { who: ReturnType<typeof resolveActivityWho> }) {
  if (who.name.state === "present") return <>{who.name.value}</>;
  return (
    <span className={cn(dsText.nums, "text-[color:var(--ds-fg-muted)]")} title={who.name.reason}>
      {who.runId}
    </span>
  );
}

function OutstandingTable({
  report,
  rows,
}: {
  report: ActivityReportWire;
  rows: readonly QueueRowIdentity[];
}) {
  const buckets = OUTSTANDING_ORDER
    .map((status) => report.statuses.find((entry) => entry.status === status))
    .filter((entry): entry is ActivityReportWire["statuses"][number] => entry !== undefined && entry.runs > 0);
  if (buckets.length === 0) return null;
  return (
    <div className="min-w-0">
      <SectionLabel className="mb-[var(--ds-space-snug)]">Still open — by what it is waiting on</SectionLabel>
      <div className="overflow-x-auto">
        <Table label="Outstanding runs by what they are waiting on">
          <THead>
            <TR>
              <TH>State</TH>
              <TH align="right">Runs</TH>
              <TH>Who</TH>
            </TR>
          </THead>
          <TBody>
            {buckets.map((bucket) => (
              <OutstandingRow
                key={bucket.status}
                status={bucket.status}
                runs={bucket.runs}
                sample={bucket.sample}
                rows={rows}
                report={report}
              />
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

export function ActivityBody({
  report,
  rows,
}: {
  report: ActivityReportWire;
  rows: readonly QueueRowIdentity[];
}) {
  const { readBack, warnings: withWarnings, warningsUnknown } = report.completion;
  const failedRuns = statusRuns(report, "failed");
  const errorRatePct = activityErrorRatePercent(report);
  const completedRuns = readBack + withWarnings + warningsUnknown;
  const median = report.durations.medianMs;
  const outstandingNote = OUTSTANDING_ORDER
    .map((status) => ({ status, runs: statusRuns(report, status) }))
    .filter((entry) => entry.runs > 0)
    .map((entry) => `${String(entry.runs)} ${statusText(dsStatusOf(entry.status)).toLowerCase()}`)
    .join(" · ");

  return (
    <div className="flex flex-col gap-[var(--ds-space-section)]">
      {report.totalRuns === 0 && <Well><p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
        No run started between {report.from} and {report.to}.
      </p></Well>}
      <div role="group" aria-label="Range-wide report totals" className="grid grid-cols-2 overflow-hidden rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] min-[1100px]:grid-cols-4">
        <ReportMetric label="Completed runs" value={String(completedRuns)} note={`of ${String(report.totalRuns)} runs in this period`} />
        <ReportMetric label="Outstanding" value={String(report.inFlightRuns)} note={outstandingNote || "No open runs"} tone="warning" />
        <ReportMetric label="Failed" value={String(failedRuns)} note={`${String(failedRuns)} of ${String(report.terminalRuns)} terminal runs · ${String(errorRatePct)}%`} />
        <ReportMetric label="Median duration" value={median.state === "present" ? ms(median.value) : "Unavailable"} note={`${String(report.durations.measuredRuns)} measured · ${String(report.durations.unmeasuredRuns)} unmeasured`} />
      </div>

      <div className="grid min-w-0 gap-[var(--ds-space-section)] min-[1160px]:grid-cols-[minmax(0,1.9fr)_minmax(17rem,1fr)]">
        <WorkflowsByCategory report={report} />
        <div className="flex min-w-0 flex-col gap-[var(--ds-space-section)]">
          <ActivityVolumeChart report={report} />
          <div className="flex flex-col gap-[var(--ds-space-snug)]">
            <h2 className={cn(dsText.title, "font-semibold text-[color:var(--ds-fg)]")}>Evidence coverage</h2>
            <div className="flex items-center justify-between gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] py-[var(--ds-space-tight)]">
              <span className={dsText.body}>Warnings read back</span>
              <strong className={cn(dsText.body, "tabular-nums")}>{readBack + withWarnings} / {completedRuns} completed</strong>
            </div>
            <div className="flex items-center justify-between gap-[var(--ds-space-base)] py-[var(--ds-space-tight)]">
              <span className={dsText.body}>Warning status unread</span>
              <strong className={cn(dsText.body, "tabular-nums")}>{warningsUnknown}</strong>
            </div>
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{activityPeopleNote(report.people)}</span>
          </div>
        </div>
      </div>

      <WriteLedgerBlock ledger={report.ledger} />

      <Disclosure summary="Outstanding work" meta={plural(report.inFlightRuns, "run")} variant="body" defaultOpen={report.inFlightRuns > 0} contentClassName="pt-[var(--ds-space-base)]">
        <OutstandingTable report={report} rows={rows} />
      </Disclosure>
      <Disclosure summary="Outcome and duration detail" meta={`${String(report.terminalRuns)} terminal runs`} variant="body" contentClassName="flex flex-col gap-[var(--ds-space-cozy)] pt-[var(--ds-space-base)]">
        <MetaLine items={[
          median.state === "present" ? `median ${ms(median.value)}` : median.reason,
          report.durations.longestMs.state === "present" ? `longest ${ms(report.durations.longestMs.value)}` : report.durations.longestMs.reason,
          `${String(report.durations.measuredRuns)} measured`,
        ]} />
        {report.durations.unmeasuredRuns > 0 && <span className={cn(dsText.meta, "flex items-center gap-[var(--ds-space-hair)] text-[color:var(--ds-status-waiting-fg)]")}>
          <TriangleAlert aria-hidden className={dsIcon.sm} />
          {report.durations.unmeasuredRuns} terminal {report.durations.unmeasuredRuns === 1 ? "run has" : "runs have"} no recorded end instant, so {report.durations.unmeasuredRuns === 1 ? "it is" : "they are"} excluded from every duration above rather than counted as zero.
        </span>}
        <ShareTable label="By outcome" total={report.terminalRuns} rows={report.outcomes.map((outcome) => ({key:outcome.outcome,label:outcome.outcome,runs:outcome.runs}))} />
      </Disclosure>
      <Disclosure summary="Failure codes" meta={plural(report.failures.length, "code")} variant="body" contentClassName="pt-[var(--ds-space-base)]">
        {report.failures.length === 0 ? <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>No run in this range settled with a structured failure.</p> :
          <div className="overflow-x-auto"><Table label="Failures by code"><THead><TR><TH>Code</TH><TH align="right">Runs</TH><TH align="right">Transient</TH><TH>Examples</TH></TR></THead><TBody>
            {report.failures.map((failure) => <TR key={failure.code}><TD numeric>{failure.code}</TD><TD numeric align="right">{failure.runs}</TD><TD numeric align="right">{failure.transient}</TD><TD numeric>{failure.sample.join(" ")}</TD></TR>)}
          </TBody></Table></div>}
      </Disclosure>
      <Disclosure summary="People and counting evidence" variant="body" contentClassName="pt-[var(--ds-space-base)]">
        <BulletList items={[...activityPeopleEvidenceItems(report.people)]} />
      </Disclosure>
    </div>
  );
}

function ReportMetric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warning" }) {
  return <div className="flex min-h-[8.125rem] min-w-0 flex-col justify-between gap-[var(--ds-space-base)] border-r border-b border-[color:var(--ds-border)] p-6 last:border-r-0 min-[1100px]:border-b-0">
    <span className={cn(dsText.body, "font-medium text-[color:var(--ds-fg-secondary)]")}>{label}</span>
    <strong className={cn(dsText.pageTitle, "font-normal tabular-nums", tone === "warning" && "text-[color:var(--ds-status-waiting-fg)]")}>{value}</strong>
    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{note}</span>
  </div>;
}

function ActivityVolumeChart({ report }: { report: ActivityReportWire }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const chartGroupRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chartBarHasFocusRef = useRef(false);
  const restoreChartFocusRef = useRef(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [tabStopIndex, setTabStopIndex] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooltipBoundary, setTooltipBoundary] = useState<HTMLElement | null>(null);
  const titleId = useId();
  const summaryId = useId();
  const model = useMemo(() => createActivityVolumeChartModel(report.volume, availableWidth), [report.volume, availableWidth]);
  const setChartBoundary = useCallback((node: HTMLElement | null) => { setTooltipBoundary(node); }, []);
  const bucketCount = model.state === "complete" ? model.buckets.length : 0;
  const currentTabStopIndex = bucketCount > 0 ? Math.min(tabStopIndex, bucketCount - 1) : 0;
  const currentActiveIndex = activeIndex !== null && activeIndex < bucketCount ? activeIndex : null;
  const seriesKey = model.state === "complete" ? model.buckets.map((bucket) => bucket.key).join("|") : "unavailable";

  useLayoutEffect(() => () => {
    restoreChartFocusRef.current = chartBarHasFocusRef.current;
  }, [seriesKey]);

  useLayoutEffect(() => {
    if (!restoreChartFocusRef.current) return;
    restoreChartFocusRef.current = false;
    if (model.state === "complete") {
      const nextIndex = Math.min(tabStopIndex, bucketCount - 1);
      setTabStopIndex(nextIndex);
      barRefs.current[nextIndex]?.focus();
      return;
    }
    chartBarHasFocusRef.current = false;
    chartGroupRef.current?.focus();
  }, [bucketCount, model.state, seriesKey, tabStopIndex]);

  useEffect(() => {
    if (model.state !== "unavailable") return;
    setTabStopIndex(0);
    setActiveIndex(null);
  }, [model.state]);

  useEffect(() => {
    const plot = plotRef.current;
    if (plot === null) return;
    const measure = () => setAvailableWidth(Math.round(plot.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setAvailableWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);

  const title = model.state === "complete" ? model.title : "Activity volume";
  return <div className="min-w-0">
    <div className="mb-[var(--ds-space-snug)] flex items-baseline justify-between gap-[var(--ds-space-base)]">
      <h2 className={cn(dsText.title, "font-semibold text-[color:var(--ds-fg)]")}>{title}</h2>
      <span className={cn(dsText.meta, "shrink-0 tabular-nums text-[color:var(--ds-fg-muted)]")}>
        {model.state === "complete" ? model.totalRuns : report.totalRuns} total
      </span>
    </div>
    <Card><CardBody className="flex flex-col gap-[var(--ds-space-base)] p-5">
      <div ref={chartGroupRef} role="group" aria-label={title} {...(model.state === "complete" ? { "aria-describedby": summaryId } : {})} tabIndex={-1} className={cn("min-w-0", dsFocus)}>
        {model.state === "unavailable" ? <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Volume series unavailable.</p> : <>
          {model.empty && <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>No runs in these reported intervals.</p>}
          <figure ref={setChartBoundary} className="m-0 min-w-0" aria-labelledby={titleId} aria-describedby={summaryId}>
            <figcaption id={titleId} className="sr-only">{model.title}</figcaption>
            <p id={summaryId} className="sr-only">{model.summary}</p>
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-[var(--ds-space-tight)]">
            <div className="relative h-[8.125rem]">
              {model.axisTicks.map((tick) => <span key={tick.value} className={cn(dsText.micro, dsText.nums, "absolute right-0 text-[color:var(--ds-fg-muted)]")} style={{ top: `${String(tick.topPercent)}%`, transform: tick.topPercent === 100 ? "translateY(-100%)" : "translateY(-50%)" }}>
                {new Intl.NumberFormat("en-US").format(tick.value)}
              </span>)}
            </div>
            <div className="min-w-0">
              <div ref={plotRef} className="relative h-[8.125rem] min-w-0">
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  {model.axisTicks.map((tick) => <span key={tick.value} className="absolute inset-x-0 border-t border-[color:var(--ds-border)]" style={{ top: `${String(tick.topPercent)}%` }} />)}
                </div>
                <TooltipProvider delayDuration={0}>
                  <div className="relative z-10 flex h-full items-end gap-[var(--ds-space-hair)]">
                    {model.buckets.map((bucket, index) => <Tooltip key={bucket.key} collisionBoundary={tooltipBoundary} content={<span>{bucket.intervalLabel} · {plural(bucket.runs, "run")}</span>}>
                      <button
                        ref={(node) => { barRefs.current[index] = node; }}
                        type="button"
                        aria-label={bucket.accessibleLabel}
                        aria-describedby={summaryId}
                        data-interval-start={bucket.intervalStart}
                        data-interval-end-exclusive={bucket.intervalEndExclusive}
                        data-time-zone={bucket.timeZone}
                        data-runs={bucket.runs}
                        tabIndex={index === currentTabStopIndex ? 0 : -1}
                        onFocus={() => { chartBarHasFocusRef.current = true; setTabStopIndex(index); setActiveIndex(index); }}
                        onBlur={() => { chartBarHasFocusRef.current = false; setActiveIndex(null); }}
                        onPointerEnter={() => setActiveIndex(index)}
                        onPointerLeave={(event) => {
                          if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) setActiveIndex(null);
                        }}
                        onKeyDown={(event) => {
                          const nextIndex = event.key === "ArrowRight" ? Math.min(index + 1, model.buckets.length - 1)
                            : event.key === "ArrowLeft" ? Math.max(index - 1, 0)
                              : event.key === "Home" ? 0
                                : event.key === "End" ? model.buckets.length - 1
                                  : undefined;
                          if (nextIndex === undefined) return;
                          event.preventDefault();
                          setTabStopIndex(nextIndex);
                          barRefs.current[nextIndex]?.focus();
                        }}
                        className={cn("relative flex h-full min-w-0 flex-1 cursor-pointer items-end justify-center rounded-t-[var(--ds-radius-sm)] bg-transparent p-0", dsFocus, index === currentActiveIndex && "bg-[color:var(--ds-info-bg)]")}
                      >
                        <span aria-hidden className={cn("block w-full max-w-8 rounded-t-[var(--ds-radius-sm)]", bucket.runs > 0 && "bg-[color:var(--ds-activity-chart-bar)]")} style={{ height: `${String(bucket.barHeightPercent)}%` }} />
                      </button>
                    </Tooltip>)}
                  </div>
                </TooltipProvider>
              </div>
              <div aria-hidden className="flex min-w-0 border-t border-[color:var(--ds-border)]">
                {model.buckets.map((bucket) => <span key={bucket.key} className={cn(dsText.micro, "min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[color:var(--ds-fg-muted)]")}>
                  {bucket.showAxisLabel ? bucket.axisLabel : ""}
                </span>)}
              </div>
            </div>
            </div>
          </figure>
        </>}
      </div>
    </CardBody></Card>
  </div>;
}

const ACTIVITY_LEDGER_SYSTEM_LABELS: Record<ActivityReportWire["ledger"]["systems"][number]["system"], string> = {
  ucpath: "UCPath",
  crm: "CRM",
  onbase: "OnBase",
  kuali: "Kuali",
  servicenow: "ServiceNow",
  i9: "I-9",
  "new-kronos": "New Kronos",
  "old-kronos": "Old Kronos",
  sharepoint: "SharePoint",
};

function WriteLedgerBlock({ ledger }: { ledger: ActivityReportWire["ledger"] }): ReactNode {
  return (
    <div className="min-w-0">
      <div className="mb-[var(--ds-space-snug)] flex flex-wrap items-baseline justify-between gap-[var(--ds-space-snug)]">
        <h2 className={cn(dsText.title, "font-semibold text-[color:var(--ds-fg)]")}>Confirmed transactions</h2>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Separate write ledger</span>
      </div>
      <p className={cn(dsText.meta, "mb-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
        Confirmed entries are separate from run totals and survive Archive transfer until explicit owner deletion.
      </p>
      {ledger.systems.length === 0 ? (
        <Well>
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
            No ledger entries. Nothing in this report&apos;s reach filed anything into a real HR system.
          </span>
        </Well>
      ) : (
        <div role="list" aria-label="Write ledger by system" className="overflow-hidden rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]">
          {ledger.systems.map((line) => (
            <div key={line.system} role="listitem" className="flex min-w-0 items-center justify-between gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)] last:border-b-0">
              <div className="min-w-0">
                <h3 className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>{ACTIVITY_LEDGER_SYSTEM_LABELS[line.system]}</h3>
                <p className={cn(dsText.meta, "mt-[var(--ds-space-hair)] text-[color:var(--ds-fg-muted)]")}>
                  {String(line.prod)} production · <span className={line.test > 0 ? "text-[color:var(--ds-status-waiting-fg)]" : undefined}>{String(line.test)} test instance{line.test === 1 ? "" : "s"}</span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <strong className={cn(dsText.section, "font-normal tabular-nums text-[color:var(--ds-fg)]")}>{line.entries}</strong>
                <span className={cn(dsText.meta, "block text-[color:var(--ds-fg-muted)]")}>confirmed entries</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityReport({
  range,
  today,
  actorId,
  appVersion,
  queueRows,
  onRange,
}: {
  /** the `from..to` value carried by the URL */
  range: string;
  today: string;
  /**
   * The queue rows the shell already holds for the day on screen — the ONE
   * place the Who column resolves a sampled run id to a name. The report is
   * not given a second fetch for them: a report that loaded its own copy of
   * the queue could name a run differently than the queue does, which is the
   * divergence D81 deletes one axis over. Rows for other days in the range are
   * simply not here, and a run they do not cover says so by id.
   */
  queueRows: readonly QueueRowIdentity[];
  /** who is reading it — a report leaves the screen, so it says who made it */
  actorId: string;
  appVersion: string;
  onRange: (next: string) => void;
}) {
  const client = useDashboardClient();
  const resolved = useMemo(() => parseActivityRange(range, today), [range, today]);
  const requestRange = activityRangeValue(resolved);
  const [refresh,setRefresh]=useState(0);
  const [response, setResponse] = useState<{ range: string; resource: AsyncResource<ActivityReportSelection> }>({ range: requestRange, resource: LOADING });
  const resource: AsyncResource<ActivityReportSelection> = resolved.refusal !== undefined
    ? failed(new DashboardClientError({ kind: "schema", message: resolved.refusal }))
    : response.range === requestRange ? response.resource : LOADING;

  useEffect(() => {
    if (resolved.refusal !== undefined) return;
    const setResource = (next: AsyncResource<ActivityReportSelection>): void => { setResponse({ range: requestRange, resource: next }); };
    setResource(LOADING);
    const controller=new AbortController();
    const stop=observeAsyncResource(() => client.activityReport(resolved.from, resolved.to,controller.signal), setResource);
    return ()=>{controller.abort();stop();};
  }, [client, requestRange, resolved.from, resolved.to, resolved.refusal,refresh]);

  const appliedRangeLabel = resolved.refusal === undefined ? activityCompactRangeLabel(resolved) : "Invalid report span";
  const report = resource.state === "loaded" ? resource.value : undefined;
  const inferredPeriod = resolved.refusal === undefined ? activityPresetOf(resolved, today) : "custom";
  const [customRangeIntent, setCustomRangeIntent] = useState<string | null>(null);
  const period = customRangeIntent === requestRange || inferredPeriod === "custom" ? "custom" : inferredPeriod;
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState<ActivityRangeDraft | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const periodSelectRef = useRef<HTMLSelectElement>(null);

  const exportRequest=useRef<AbortController|null>(null);
  const [exportState,setExportState]=useState<"idle"|"pending"|"started"|"cancelled"|"failed">("idle");
  useEffect(()=>{setExportState("idle");return ()=>{exportRequest.current?.abort();exportRequest.current=null;};},[requestRange,refresh]);
  const exportReport = useCallback(async (format:"csv"|"xlsx") => {
    if(report===undefined)return;
    const controller=new AbortController();exportRequest.current?.abort();exportRequest.current=controller;setExportState("pending");
    try {
      const download=format==="csv"?await client.exportActivityCsv(report,controller.signal)
        :await client.exportXlsx({requestVersion:3,selection:{kind:"activity",from:report.from,to:report.to,snapshotToken:report.snapshot.token}},controller.signal);
      if(controller.signal.aborted||exportRequest.current!==controller)return;
      saveDownload(download);setExportState("started");
    } catch {if(!controller.signal.aborted&&exportRequest.current===controller){setExportState("failed");}} finally {if(exportRequest.current===controller)exportRequest.current=null;}
  }, [client,report]);

  const changeDatePickerOpen = (next: boolean, focusAfterClose?: "period" | "date") => {
    if (next) {
      setDateDraft(resolved.refusal === undefined
        ? activityRangeDraft({ from: resolved.from, to: resolved.to })
        : { from: null, to: null });
    } else {
      setDateDraft(null);
      const target = focusAfterClose ?? (period === "custom" ? "date" : "period");
      window.requestAnimationFrame(() => {
        (target === "date" ? dateTriggerRef.current : periodSelectRef.current)?.focus();
      });
    }
    setDatePickerOpen(next);
  };

  const applyDateDraft = () => {
    if (dateDraft === null) return;
    const result = applyActivityRangeDraft(dateDraft);
    if (result.state !== "ready") return;
    const nextRange = activityRangeValue(result.model.selection);
    setCustomRangeIntent(nextRange);
    onRange(nextRange);
    changeDatePickerOpen(false, "date");
  };

  const choosePreset = (value: string) => {
    const preset = ACTIVITY_DATE_PRESETS.find(entry => entry.value === value);
    if (preset === undefined) return;
    if (preset.value === "custom") {
      changeDatePickerOpen(true);
      return;
    }
    setCustomRangeIntent(null);
    changeDatePickerOpen(false, "period");
    onRange(activityRangeValue(activityPresetRange(preset.value, today)));
  };

  return (
    <TakeoverFrame label="Activity report">
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-[var(--ds-space-cozy)] py-[var(--ds-space-cozy)]", dsSurface.bodyPage)}>
        <DsBodyScope className="activity-report-body flex w-full flex-col gap-[var(--ds-space-cozy)]">
          <header className="activity-report-heading flex min-h-[var(--ds-h-toolbar)] flex-wrap items-center justify-between gap-[var(--ds-space-base)] rounded-[var(--ds-radius-lg)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]">
            <div className="flex min-w-0 items-center gap-[var(--ds-space-base)]">
              <ChartNoAxesColumnIncreasing aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
              <h1 className={cn(dsText.title, dsText.flush, "shrink-0 font-semibold text-[color:var(--ds-fg)]")}>Activity</h1>
              <span aria-hidden className="h-[var(--ds-h-sm)] w-px shrink-0 bg-[color:var(--ds-border)]" />
              {period === "custom" || datePickerOpen ? <ActivityDateControl
                from={resolved.from}
                to={resolved.to}
                today={today}
                invalid={resolved.refusal !== undefined}
                draft={dateDraft}
                onDraftChange={setDateDraft}
                onApply={applyDateDraft}
                open={datePickerOpen}
                triggerRef={dateTriggerRef}
                onOpenChange={changeDatePickerOpen}
              /> : <span className={cn(dsText.meta, dsText.nums, "whitespace-nowrap text-[color:var(--ds-fg-secondary)]")} aria-label={`Report date range: ${appliedRangeLabel}`}>{appliedRangeLabel}</span>}
            </div>

            <div className="flex shrink-0 items-center gap-[var(--ds-space-snug)]">
              <div className="activity-report-period">
                <Select ref={periodSelectRef} variant="toolbar" aria-label="Report period" value={datePickerOpen ? "custom" : period} onChange={event => { choosePreset(event.target.value); }}>
                  {ACTIVITY_DATE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                </Select>
              </div>
              <Popover open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
                <PopoverTrigger asChild>
                  <Button size="toolbar" variant="outline" aria-label="Export report" disabled={report === undefined} icon={<Download aria-hidden className={dsIcon.sm} />}>
                    Export report <ChevronDown aria-hidden className={dsIcon.sm} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent title="Export report" width="sm" align="end">
                  <div className="flex flex-col gap-[var(--ds-space-tight)]">
                    <Button variant="ghost" className="w-full justify-start" disabled={exportState === "pending"} onClick={() => { setExportMenuOpen(false); void exportReport("csv"); }}>Export CSV</Button>
                    <Button variant="ghost" className="w-full justify-start" disabled={exportState === "pending"} onClick={() => { setExportMenuOpen(false); void exportReport("xlsx"); }}>Export XLSX</Button>
                    {exportState === "pending" && <Button variant="ghost" className="w-full justify-start" onClick={() => { exportRequest.current?.abort(); exportRequest.current = null; setExportState("cancelled"); setExportMenuOpen(false); }}>Cancel download</Button>}
                  </div>
                </PopoverContent>
              </Popover>
              {report !== undefined && <>
                <Popover>
                  <PopoverTrigger asChild><Button size="sm" variant="ghost" icon={<Info aria-hidden className={dsIcon.md} />}>How it is counted</Button></PopoverTrigger>
                  <PopoverContent title="How this report is counted" width="lg" align="end"><BulletList items={[...activityReportCaveats(report)]} /></PopoverContent>
                </Popover>
                <Button size="sm" variant="ghost" onClick={() => { exportRequest.current?.abort(); exportRequest.current = null; setResponse({ range: requestRange, resource: LOADING }); setRefresh(value => value + 1); }}>Refresh report</Button>
              </>}
            </div>
          </header>

          <div className="activity-report-frame flex min-w-0 flex-col gap-[var(--ds-space-section)] rounded-[var(--ds-radius-lg)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] p-6">
            {exportState === "failed" && <Refusal code="selection-export-refused" title="Export refused" outcome="No file was downloaded. Refresh the report and retry the reviewed selection.">The selection expired, changed, or failed verification.</Refusal>}
            {exportState === "cancelled" && <p role="status">Download cancelled locally. A registered XLSX export may still finish on the server.</p>}
            {exportState === "started" && <p role="status">Verified file handed to the browser.</p>}
            {resource.state === "loading" || resource.state === "idle" ? <Skeleton className="h-64 w-full" /> :
              resource.state === "failed" ? <Refusal title="The activity report could not be built" code="activity-read-failed" outcome="Nothing was changed; this surface only reads.">
                <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{resource.error.message}</p>
              </Refusal> : <ActivityBody report={resource.value} rows={queueRows} />}
          </div>

          <footer className="border-t border-[color:var(--ds-border)] pt-[var(--ds-space-base)]">
            <MetaLine items={[
              report === undefined ? "Report not yet generated" : `generated ${fmtClock(report.generatedAt)}`,
              actorId,
              `app ${appVersion}`,
            ]} />
          </footer>
        </DsBodyScope>
      </div>
    </TakeoverFrame>
  );
}
