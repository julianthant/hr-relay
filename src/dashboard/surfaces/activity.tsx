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
 * renders the payload verbatim — including the range's own day list, which is
 * why a day with no runs is simply absent rather than being invented as a zero.
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
import { CalendarDays,ChevronDown,Download,Info,TriangleAlert } from "lucide-react";
import { RangeCalendar as HeroRangeCalendar } from "@heroui/react";
import { parseDate,type CalendarDate } from "@internationalized/date";
import { useCallback,useEffect,useMemo,useState,useRef,type ReactNode } from "react";
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
dsIcon,
dsSurface,
dsText,
MetaLine,
PageHeading,
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
TR,
Well,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useActivityClient as useDashboardClient } from "../state/activity-client.js";
import { failed,LOADING,type AsyncResource } from "../state/async-resource.js";
import {
activityPeopleEvidenceItems,
activityPeopleMeta,
activityPeopleNote,
activityPeriodOf,
activityPeriodRange,
activityRangeLabel,
activityRangeValue,
parseActivityRange,
resolveActivityWho,
type QueueRowIdentity,
} from "./activity-model.js";
import { fmtClock,plural } from "./format.js";
import { dsStatusOf,statusText,type QueueStatus } from "./status-model.js";

/* the range vocabulary lives in `activity-model.ts` — see the note there */

function calendarDate(value: string): CalendarDate | null {
  try { return parseDate(value); } catch { return null; }
}

function dateControlLabel(from: string, to: string): string {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const short = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const full = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (from === to) return full(start);
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${full(start)} – ${full(end)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${short(start)} – ${to.slice(8)}, ${to.slice(0, 4)}`;
  return `${short(start)} – ${full(end)}`;
}

function ActivityDateControl({ from, to, invalid, onRange, open, onOpenChange }: {
  from: string;
  to: string;
  invalid: boolean;
  onRange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const start = calendarDate(from);
  const end = calendarDate(to);
  const selected = !invalid && start !== null && end !== null;
  const label = selected ? dateControlLabel(from, to) : "Choose dates";
  const choose = (first: string, last: string) => {
    onRange(activityRangeValue({ from: first, to: last }));
    onOpenChange(false);
  };
  return <Popover open={open} onOpenChange={next => { onOpenChange(next); if (!next) setYearPickerOpen(false); }}>
    <PopoverTrigger asChild>
      <Button size="toolbar" variant="secondary" aria-label={`Select report dates: ${label}`} aria-invalid={invalid || undefined} icon={<CalendarDays aria-hidden className={dsIcon.sm} />}>
        <span className="tabular-nums">{label}</span><ChevronDown aria-hidden className={dsIcon.sm} />
      </Button>
    </PopoverTrigger>
    <PopoverContent title="Select report dates" hideTitle align="end" width="md" className="ds-date-popover">
      <HeroRangeCalendar aria-label="Choose report date range" className="ds-hero-calendar" isYearPickerOpen={yearPickerOpen} onYearPickerOpenChange={setYearPickerOpen} value={selected ? { start, end } : null} onChange={dates => { if (dates !== null) choose(dates.start.toString(), dates.end.toString()); }}>
        <HeroRangeCalendar.Header>
          <HeroRangeCalendar.NavButton className="text-foreground" slot="previous" aria-label="Previous month" />
          <HeroRangeCalendar.YearPickerTrigger className="w-full justify-center">
            <HeroRangeCalendar.YearPickerTriggerHeading className="text-foreground" />
            <HeroRangeCalendar.YearPickerTriggerIndicator className="text-foreground" />
          </HeroRangeCalendar.YearPickerTrigger>
          <HeroRangeCalendar.NavButton className="text-foreground" slot="next" aria-label="Next month" />
        </HeroRangeCalendar.Header>
        <HeroRangeCalendar.Grid><HeroRangeCalendar.GridHeader>{day => <HeroRangeCalendar.HeaderCell>{day}</HeroRangeCalendar.HeaderCell>}</HeroRangeCalendar.GridHeader><HeroRangeCalendar.GridBody>{date => <HeroRangeCalendar.Cell date={date} />}</HeroRangeCalendar.GridBody></HeroRangeCalendar.Grid>
        {yearPickerOpen && <HeroRangeCalendar.YearPickerGrid><HeroRangeCalendar.YearPickerGridBody>{({ year }) => <HeroRangeCalendar.YearPickerCell year={year} />}</HeroRangeCalendar.YearPickerGridBody></HeroRangeCalendar.YearPickerGrid>}
      </HeroRangeCalendar>
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
  failed: number;
  open: number;
}

const EMPTY_CELLS: WorkflowCells = { readBack: 0, warnings: 0, warningsUnknown: 0, failed: 0, open: 0 };

function cellsOf(workflow: ActivityReportWire["workflows"][number]): WorkflowCells {
  return {
    readBack: workflow.completion.readBack,
    warnings: workflow.completion.warnings,
    warningsUnknown: workflow.completion.warningsUnknown,
    failed: workflow.failed,
    open: workflow.open,
  };
}

function sumCells(rows: readonly WorkflowCells[]): WorkflowCells {
  return rows.reduce<WorkflowCells>((total, row) => ({
    readBack: total.readBack + row.readBack,
    warnings: total.warnings + row.warnings,
    warningsUnknown: total.warningsUnknown + row.warningsUnknown,
    failed: total.failed + row.failed,
    open: total.open + row.open,
  }), EMPTY_CELLS);
}

function CategoryBody({
  label,
  reason,
  workflows,
  subtotalRuns,
  total,
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
  workflows: readonly { workflowId: string; label: ReactNode; runs: number; cells: WorkflowCells }[];
  subtotalRuns: number;
  total: number;
  showSubtotal?: boolean;
}) {
  return (
    <TBody>
      <TR className="h-auto">
        <TD colSpan={8} className="bg-[var(--ds-surface-2)] py-[var(--ds-space-tight)]">
          {/*
            AC90 (D276 item 4) is a KEPT divergence, not unported drift. The
            demo's group row holds a label and a count and stops; this one adds
            a `reason` that `truncate`s. Without `shrink-0` the flex algorithm
            shrinks the leftmost items first, so the group's NAME would clip
            before the optional sentence beside it — the truncation would land
            on the wrong element. The `shrink-0` is what makes the demo's own
            truncation target correct here.
          */}
          <span className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
            <SectionLabel className="shrink-0">{label}</SectionLabel>
            <span className={cn(dsText.micro, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
              {plural(workflows.length, "workflow")}
            </span>
            {reason !== undefined && (
              <span className={cn(dsText.micro, "min-w-0 truncate text-[color:var(--ds-fg-faint)]")}>{reason}</span>
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
          total={total}
        />
      ))}
      {showSubtotal && <WorkflowRow
        label={`${label} — subtotal`}
        runs={subtotalRuns}
        cells={sumCells(workflows.map((workflow) => workflow.cells))}
        total={total}
        subtotal
      />}
    </TBody>
  );
}

function WorkflowRow({
  label,
  runs,
  cells,
  total,
  subtotal,
}: {
  label: ReactNode;
  runs: number;
  cells: WorkflowCells;
  total: number;
  subtotal?: boolean;
}) {
  // SHARE AS A NUMBER, one decimal — the demo's own choice. A per-row bar is
  // mostly empty track with a stub, which compares nothing legibly and, once
  // the table is grouped, compares a workflow against a total that is no longer
  // the block it sits in.
  const share = total === 0 ? 0 : Math.round((runs / total) * 1000) / 10;
  const cell = subtotal ? "font-semibold text-[color:var(--ds-fg)]" : undefined;
  return (
    <TR className={subtotal ? "bg-[var(--ds-surface-2)]" : undefined}>
      <TD className={cn(cell, subtotal ? undefined : "text-[color:var(--ds-fg)]")}>{label}</TD>
      <TD align="right" numeric className={cell}>
        {runs}
      </TD>
      <TD align="right" numeric className={cn(cell, "text-[color:var(--ds-fg-muted)]")}>
        {share}%
      </TD>
      <TD align="right" numeric className={cell}>
        {cells.readBack}
      </TD>
      <TD align="right" numeric className={cell}>
        {cells.warnings}
      </TD>
      {/*
        THE UNREAD COLUMN IS THE HONEST ONE, and it is why this table has eight
        columns without the demo's `Est. min saved`. A `done` run with no
        derived evidence receipt has a warning set nobody has read; adding it to
        `Read back` would put "came back clean" on a supervisor's copy over a
        run nobody checked. It is muted rather than tinted — it is an absence,
        not a problem, and amber is already spoken for by open work below.
      */}
      <TD
        align="right"
        numeric
        className={cn(cell, "text-[color:var(--ds-fg-muted)]")}
        title={
          cells.warningsUnknown > 0
            ? `${String(cells.warningsUnknown)} finished ${cells.warningsUnknown === 1 ? "run has" : "runs have"} no derived evidence receipt, so ${cells.warningsUnknown === 1 ? "its" : "their"} warning set is unread`
            : undefined
        }
      >
        {cells.warningsUnknown}
      </TD>
      <TD align="right" numeric className={cn(cell, cells.failed > 0 && "text-[color:var(--ds-status-failed-fg)]")}>
        {cells.failed}
      </TD>
      <TD align="right" numeric className={cn(cell, cells.open > 0 && "text-[color:var(--ds-status-waiting-fg)]")}>
        {cells.open}
      </TD>
    </TR>
  );
}

/**
 * The per-workflow table, grouped by the served category axis.
 *
 * Eight columns, like the demo's, but not the same eight. `Read back`,
 * `Warnings`, `Failed` and `Open` are the served cross-tab, rendered verbatim.
 * `Unread` is NEW and has no demo counterpart: the demo's corpus knows every
 * run's warnings because it is a fixture, and this one reads a derived receipt
 * that a real run may not have yet — so the runs whose warning set is unread
 * get a column instead of being folded into the clean one.
 *
 * One demo element is still absent, recorded in `docs/findings/activity.md`
 * rather than approximated. `Est. min saved` multiplies an operator-entered
 * minutes-per-workflow constant that has no durable home, no owner and no edit
 * path — the one number in the demo's whole report that is not measured, and
 * the last thing to fabricate on the page a supervisor reads. Workflow code is
 * now served from the registry and never derived here.
 */
function WorkflowsByCategory({ report, focus, onFocus }: { report: ActivityReportWire; focus: string; onFocus: (value: string) => void }) {
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
      .filter((workflow) => focus === "all" || workflow.workflowId === focus)
      .map((workflow) => ({
        workflowId: workflow.workflowId,
        // The SHORT CODE leads the name cell (D242), for the reason the archive
        // index adopted it: the label is the wide half and the code is four
        // characters. An UNREGISTERED workflow has neither, so it keeps its
        // amber id — the code is a registry fact, and this row is exactly the
        // row that says the registry no longer has one.
        label:
          workflow.registration.state === "registered"
            ? (
              <span className="inline-flex items-baseline gap-[var(--ds-space-snug)]">
                <span className={cn(dsText.nums, dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                  {workflow.registration.code}
                </span>
                <span>{workflow.registration.label}</span>
              </span>
            )
            : <span className="text-[color:var(--ds-status-waiting-fg)]">{workflow.workflowId}</span>,
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
  }).filter((block) => block.workflows.length > 0);

  return (
    <div className="min-w-0">
      <div className="mb-[var(--ds-space-snug)] flex flex-wrap items-center justify-between gap-[var(--ds-space-base)]">
        <SectionLabel>Workflow outcomes</SectionLabel>
        <label className={cn(dsText.meta, "flex items-center gap-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
          Show workflow
          <Select variant="toolbar" aria-label="Show workflow in breakdown" value={focus} onChange={(event) => onFocus(event.target.value)}>
            <option value="all">All workflows</option>
            {report.workflows.map((workflow) => <option key={workflow.workflowId} value={workflow.workflowId}>
              {workflow.registration.state === "registered" ? workflow.registration.label : workflow.workflowId}
            </option>)}
          </Select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]">
        <Table label="Activity by workflow, grouped by category">
          <THead>
            <TR>
              <TH>Workflow</TH>
              <TH align="right">Runs</TH>
              <TH align="right">Share of report</TH>
              <TH align="right">Read back</TH>
              <TH align="right">Warnings</TH>
              <TH align="right">Unread</TH>
              <TH align="right">Failed</TH>
              <TH align="right">Open</TH>
            </TR>
          </THead>
          {blocks.map((block) => (
            <CategoryBody
              key={block.key}
              label={block.label}
              workflows={block.workflows}
              subtotalRuns={focus === "all" ? block.subtotalRuns : block.workflows[0]?.runs ?? 0}
              total={report.totalRuns}
              showSubtotal={focus === "all" && block.workflows.length > 1}
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
  const [workflowFocus, setWorkflowFocus] = useState("all");
  const selectedWorkflow = report.workflows.some((workflow) => workflow.workflowId === workflowFocus) ? workflowFocus : "all";
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
      <div role="group" aria-label="Range-wide report totals" className="grid grid-cols-2 overflow-hidden rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] min-[1100px]:grid-cols-4">
        <ReportMetric label="Completed runs" value={String(completedRuns)} note={`of ${String(report.totalRuns)} runs in this period`} />
        <ReportMetric label="Outstanding" value={String(report.inFlightRuns)} note={outstandingNote || "No open runs"} tone="warning" />
        <ReportMetric label="Failed" value={String(failedRuns)} note={`${String(failedRuns)} of ${String(report.terminalRuns)} terminal runs · ${String(errorRatePct)}%`} />
        <ReportMetric label="Median duration" value={median.state === "present" ? ms(median.value) : "Unavailable"} note={`${String(report.durations.measuredRuns)} measured · ${String(report.durations.unmeasuredRuns)} unmeasured`} />
      </div>

      <div className="grid min-w-0 gap-[var(--ds-space-section)] min-[1160px]:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-[var(--ds-space-section)]">
          <WorkflowsByCategory report={report} focus={selectedWorkflow} onFocus={setWorkflowFocus} />
          <WriteLedgerBlock ledger={report.ledger} />
        </div>
        <div className="flex min-w-0 flex-col gap-[var(--ds-space-section)]">
          <DailyVolume report={report} />
          <div className="flex flex-col gap-[var(--ds-space-snug)]">
            <SectionLabel>Evidence coverage</SectionLabel>
            <div className="flex items-center justify-between gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] py-[var(--ds-space-tight)]">
              <span className={dsText.body}>Warnings read back</span>
              <strong className={cn(dsText.body, dsText.nums)}>{readBack + withWarnings} / {completedRuns} completed</strong>
            </div>
            <div className="flex items-center justify-between gap-[var(--ds-space-base)] py-[var(--ds-space-tight)]">
              <span className={dsText.body}>Warning status unread</span>
              <strong className={cn(dsText.body, dsText.nums)}>{warningsUnknown}</strong>
            </div>
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{activityPeopleNote(report.people)}</span>
          </div>
        </div>
      </div>

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
          {report.durations.unmeasuredRuns} finished {report.durations.unmeasuredRuns === 1 ? "run has" : "runs have"} no recorded end instant, so {report.durations.unmeasuredRuns === 1 ? "it is" : "they are"} excluded from every duration above rather than counted as zero.
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
  return <div className="flex min-w-0 flex-col gap-[var(--ds-space-tight)] border-r border-b border-[color:var(--ds-border)] p-[var(--ds-space-base)] last:border-r-0">
    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-secondary)]")}>{label}</span>
    <strong className={cn(dsText.display, dsText.nums, tone === "warning" && "text-[color:var(--ds-status-waiting-fg)]")}>{value}</strong>
    <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{note}</span>
  </div>;
}

function DailyVolume({ report }: { report: ActivityReportWire }) {
  const largest = report.days.reduce((max, day) => Math.max(max, day.runs), 1);
  return <div className="min-w-0">
    <SectionLabel className="mb-[var(--ds-space-snug)]">Daily volume</SectionLabel>
    <Card><CardBody className="flex flex-col gap-[var(--ds-space-base)]">
      <div className="flex justify-between gap-[var(--ds-space-base)]"><strong className={dsText.title}>Runs by day</strong><span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>{report.totalRuns} total</span></div>
      {report.days.length === 0 ? <p className={dsText.meta}>No run started in this period.</p> :
        <div className="flex min-h-[var(--ds-h-xxl)] items-end gap-[var(--ds-space-tight)] overflow-x-auto border-b border-[color:var(--ds-border)] pb-[var(--ds-space-tight)]">
          {report.days.map((day) => <div key={day.day} className="flex min-w-[var(--ds-h-md)] flex-1 flex-col items-center gap-[var(--ds-space-tight)]">
            <span className={cn(dsText.micro, dsText.nums)}>{day.runs}</span>
            <span aria-hidden className="w-full rounded-t-[var(--ds-radius-sm)] bg-[color:var(--ds-fg-muted)]" style={{height:`${String(Math.max(4, Math.round(day.runs / largest * 72)))}px`}} />
            <time dateTime={day.day} aria-label={day.day} className={cn(dsText.micro, dsText.nums, "whitespace-nowrap text-[color:var(--ds-fg-muted)]")}>{day.day.slice(5)}</time>
          </div>)}
        </div>}
      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Days without recorded runs are omitted.</span>
    </CardBody></Card>
  </div>;
}

/**
 * The write ledger — what was actually FILED (D236).
 *
 * The ONE block on this page whose numbers are not the run/queue projection's,
 * and it says so in its own subtitle rather than only in the ⓘ: a second
 * authority the reader cannot see is a second authority the reader assumes is
 * the first one. The empty state is served now that the axis is — before D236
 * it was omitted entirely, because "nothing was filed" over an unserved axis is
 * an assertion, not an absence.
 *
 * The test-instance count is tinted whenever it is positive, which is the
 * demo's own rule and the honest one: a rehearsal that reached a real system's
 * test instance is not a production filing and must never read as one.
 */
function WriteLedgerBlock({ ledger }: { ledger: ActivityReportWire["ledger"] }): ReactNode {
  return (
    <div className="min-w-0">
      <div className="mb-[var(--ds-space-snug)] flex flex-wrap items-baseline justify-between gap-[var(--ds-space-snug)]">
        <SectionLabel>Confirmed transactions</SectionLabel>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Separate write ledger</span>
      </div>
      <p className={cn(dsText.meta, "mb-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
        Confirmed entries survive Archive transfer until explicit owner deletion.
      </p>
      {ledger.systems.length === 0 ? (
        <Well>
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
            No ledger entries. Nothing in this report&apos;s reach filed anything into a real HR system.
          </span>
        </Well>
      ) : (
        <div className="overflow-x-auto rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]">
          <Table label="Write ledger by system">
            <THead>
              <TR>
                <TH>System</TH>
                <TH align="right">Entries</TH>
                <TH align="right">Production</TH>
                <TH align="right">Test instance</TH>
              </TR>
            </THead>
            <TBody>
              {ledger.systems.map((line) => (
                <TR key={line.system}>
                  <TD>{line.system}</TD>
                  <TD align="right" numeric>{line.entries}</TD>
                  <TD align="right" numeric>{line.prod}</TD>
                  <TD
                    align="right"
                    numeric
                    className={line.test > 0 ? "text-[color:var(--ds-status-waiting-fg)]" : undefined}
                  >
                    {line.test}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
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

  const spanLabel = resolved.refusal === undefined ? activityRangeLabel(resolved.from, resolved.to) : "Invalid report span";
  const report = resource.state === "loaded" ? resource.value : undefined;
  const period = resolved.refusal === undefined ? activityPeriodOf(resolved, today) : "custom";
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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

  return (
    <TakeoverFrame label="Activity report">
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-[var(--ds-space-page)] py-[var(--ds-space-page)]", dsSurface.bodyPage)}>
        <DsBodyScope className="mx-auto flex flex-col gap-[var(--ds-space-section)]" style={{ maxWidth: "var(--ds-w-body-performance)" }}>
          <PageHeading
            title="Activity"
            description={spanLabel}
            actions={report === undefined ? undefined : <span role="group" aria-label="Export activity report" className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
              <Button size="sm" variant="secondary" icon={<Download aria-hidden className={dsIcon.md} />} disabled={exportState === "pending"} onClick={() => { void exportReport("csv"); }}>Export CSV</Button>
              <Button size="sm" variant="secondary" disabled={exportState === "pending"} onClick={() => { void exportReport("xlsx"); }}>Export XLSX</Button>
              {exportState === "pending" && <Button size="sm" variant="ghost" onClick={() => { exportRequest.current?.abort(); exportRequest.current = null; setExportState("cancelled"); }}>Cancel download</Button>}
            </span>}
          />

          <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)] border-b border-[color:var(--ds-border)] pb-[var(--ds-space-base)]">
            <label className={cn(dsText.meta, "flex items-center gap-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
              Period
              <Select variant="toolbar" aria-label="Report period" value={datePickerOpen ? "custom" : period} onChange={(event) => {
                const next = event.target.value;
                if (next === "custom") { setDatePickerOpen(true); return; }
                if (next === "today" || next === "week" || next === "month") onRange(activityRangeValue(activityPeriodRange(next, today)));
              }}>
                <option value="today">Today</option><option value="week">This week</option><option value="month">Month to date</option><option value="custom">Custom range</option>
              </Select>
            </label>
            <ActivityDateControl from={resolved.from} to={resolved.to} invalid={resolved.refusal !== undefined} onRange={onRange} open={datePickerOpen} onOpenChange={setDatePickerOpen} />
            {report !== undefined && <span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-muted)]")}>{plural(report.totalRuns, "run")} · all workflows · {activityPeopleMeta(report.people)}</span>}
            {report !== undefined && <Popover>
              <PopoverTrigger asChild><Button size="sm" variant="ghost" icon={<Info aria-hidden className={dsIcon.md} />}>How it is counted</Button></PopoverTrigger>
              <PopoverContent title="How this report is counted" width="lg" align="end"><BulletList items={[...activityReportCaveats(report)]} /></PopoverContent>
            </Popover>}
            {report !== undefined && <Button size="sm" variant="ghost" onClick={() => { exportRequest.current?.abort(); exportRequest.current = null; setResponse({ range: requestRange, resource: LOADING }); setRefresh(value => value + 1); }}>Refresh report</Button>}
          </div>

          {exportState === "failed" && <Refusal code="selection-export-refused" title="Export refused" outcome="No file was downloaded. Refresh the report and retry the reviewed selection.">The selection expired, changed, or failed verification.</Refusal>}
          {exportState === "cancelled" && <p role="status">Download cancelled locally. A registered XLSX export may still finish on the server.</p>}
          {exportState === "started" && <p role="status">Verified file handed to the browser.</p>}
          {resource.state === "loading" || resource.state === "idle" ? <Skeleton className="h-64 w-full" /> :
            resource.state === "failed" ? <Refusal title="The activity report could not be built" code="activity-read-failed" outcome="Nothing was changed; this surface only reads.">
              <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{resource.error.message}</p>
            </Refusal> : resource.value.totalRuns === 0 ? <>
              <Well><p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                No run started between {resource.value.from} and {resource.value.to}. Archived runs are deliberately not counted here — they left the live surfaces when their version bumped, and the Archive is where they are read.
              </p></Well>
              <WriteLedgerBlock ledger={resource.value.ledger} />
            </> : <ActivityBody report={resource.value} rows={queueRows} />}

          <footer className="border-t border-[color:var(--ds-border)] pt-[var(--ds-space-base)]">
            <MetaLine items={[
              report === undefined ? `${spanLabel} — not yet generated` : `generated ${fmtClock(report.generatedAt)}`,
              actorId,
              `app ${appVersion}`,
              spanLabel,
              report === undefined ? undefined : plural(report.totalRuns, "run"),
            ].filter((item): item is string => item !== undefined)} />
          </footer>
        </DsBodyScope>
      </div>
    </TakeoverFrame>
  );
}
