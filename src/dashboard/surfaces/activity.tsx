/**
 * Ported from legacy hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e,
 * `src/dashboard/components/dev/rebuild-demo/DemoActivityReport.tsx` and
 * `demo-report-wire.ts` (the operator's rebuild-demo). Adapted to the served
 * `ActivityReportWire` — never linked at runtime (D93/D94).
 *
 * The Activity report (doc 13 §5 "Activity", §6.7, D180).
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
 * ## Every total descends from the ONE projection
 *
 * Nothing on this page counts anything. D81 and doc 13 §8 guard #4 name
 * Activity aggregates explicitly, so the server builds them inside the same
 * `run-queue-projection` that renders the Queue Panel and this component
 * renders the payload verbatim — including the range's own day list, which is
 * why a day with no runs is simply absent rather than being invented as a zero.
 *
 * ## Durations report their misses
 *
 * D124's lesson was that a surface must never substitute `now` for a terminal
 * instant nobody recorded. An aggregate has the same duty at scale, so the
 * duration block states the measured count and the unmeasured count side by
 * side. A median over a denominator that quietly dropped its unknowns is the
 * kind of number that gets quoted in a meeting.
 *
 * ## What the demo has that this does not, and why nothing here approximates it
 *
 * The demo's report reads a fixture corpus of whole rows; this one reads an
 * aggregate wire. Five demo elements need facts `ActivityReportWire` does not
 * carry — distinct people, the operator's per-workflow minutes (hours saved),
 * the per-workflow status breakdown, the identities behind each outstanding
 * bucket, and the write ledger — plus an Export command the BFF does not serve.
 * Each is RECORDED in `docs/findings/activity.md`, not fabricated here: a
 * supervisor-facing artifact is the last place a plausible-but-wrong number
 * belongs.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChartNoAxesColumn, Info, TriangleAlert } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  BulletList,
  Button,
  Card,
  CardBase,
  CardBody,
  Field,
  IconButton,
  Input,
  MetaLine,
  PageHeader,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Refusal,
  SectionLabel,
  Skeleton,
  StatusPill,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Well,
  dsIcon,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import type { ActivityReportWire } from "../../domain/dashboard/activity.js";
import { DashboardClientError } from "../client/errors.js";
import { useDashboardClient } from "../state/client-context.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { dsStatusOf, type QueueStatus } from "./status.js";
import { dayLabel, fmtClock, plural } from "./format.js";

/** `from..to`, the one shape the URL carries. */
export function parseActivityRange(value: string, today: string): { from: string; to: string } {
  const [from, to] = value.split("..");
  const valid = (candidate: string | undefined): candidate is string =>
    candidate !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(candidate);
  if (valid(from) && valid(to) && from <= to) return { from, to };
  // The default is the current month to date — a range the operator can widen,
  // never a silently different one than the link said.
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function activityRangeValue(range: { from: string; to: string }): string {
  return `${range.from}..${range.to}`;
}

/**
 * The span's own label — the demo's `ReportSpan.label`, derived here from the
 * two bounds the wire requires (D180: both bounds are named, never defaulted).
 * A one-day range reads as the day, exactly as the demo's single-day span does.
 */
export function activityRangeLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
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
 * The non-terminal wire statuses, in the demo's own OUTSTANDING_ORDER — which
 * is the ds status vocabulary (`waiting`, `parked`, `running`, `queued`) read
 * back through the ONE wire→ds map in `status.tsx`, so there is no second
 * ordering to drift from the one the queue renders.
 */
const OUTSTANDING_ORDER: readonly QueueStatus[] = ["awaiting-approval", "blocked", "running", "queued"];

function statusRuns(report: ActivityReportWire, status: QueueStatus): number {
  return report.statuses.find((entry) => entry.status === status)?.runs ?? 0;
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
 * One headline number, ported from the demo's `Tile`.
 *
 * The header row is RESERVED at the ⓘ button's own height on every tile so one
 * tile carrying a control cannot drop its big number, and the note under it,
 * below its siblings' on the row the eye reads straight across. `CardBase`
 * pins the notes to one baseline for the same reason.
 *
 * DEVIATION from the demo: there is no `estimate` tone and no `estimate` badge,
 * because the one tile that wore them — Hours saved — is powered by an
 * operator-entered minutes-per-workflow constant this wire does not carry.
 * Rendering the badge with no estimate behind it would be decoration.
 */
function Tile({
  label,
  value,
  note,
  tone = "default",
  info,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "default" | "warning";
  /** the REASONING behind the number — a rule of the report, so it lives here */
  info?: ReactNode;
}) {
  return (
    <Card tone={tone === "warning" ? "attention" : "default"}>
      <CardBody grow className="flex flex-col gap-[var(--ds-space-hair)]">
        <span className="flex min-h-[var(--ds-h-xs)] items-center gap-[var(--ds-space-snug)]">
          <SectionLabel className="min-w-0 truncate">{label}</SectionLabel>
          {info && (
            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  size="xs"
                  label={`How ${label.toLowerCase()} is counted`}
                  icon={<Info aria-hidden className={dsIcon.sm} />}
                  className="ml-auto text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]"
                />
              </PopoverTrigger>
              <PopoverContent title={label} width="lg" align="end">
                {info}
              </PopoverContent>
            </Popover>
          )}
        </span>
        <span className={cn(dsText.display, dsText.nums, "text-[color:var(--ds-fg)]")}>{value}</span>
        {/* The notes run one and two lines. Pinned, they end on one baseline
            across the row instead of each stopping wherever its own copy did. */}
        <CardBase className="pt-[var(--ds-space-hair)]">
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{note}</span>
        </CardBase>
      </CardBody>
    </Card>
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
function CategoryBody({
  label,
  reason,
  workflows,
  subtotalRuns,
  total,
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
  workflows: readonly { workflowId: string; label: ReactNode; runs: number }[];
  subtotalRuns: number;
  total: number;
}) {
  return (
    <TBody>
      <TR className="h-auto">
        <TD colSpan={3} className="bg-[var(--ds-surface-2)] py-[var(--ds-space-tight)]">
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
        <WorkflowRow key={workflow.workflowId} label={workflow.label} runs={workflow.runs} total={total} />
      ))}
      <WorkflowRow label={`${label} — subtotal`} runs={subtotalRuns} total={total} subtotal />
    </TBody>
  );
}

function WorkflowRow({
  label,
  runs,
  total,
  subtotal,
}: {
  label: ReactNode;
  runs: number;
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
    </TR>
  );
}

/**
 * The per-workflow table, grouped by the served category axis.
 *
 * DEVIATION from the demo, recorded in `docs/findings/activity.md`: the demo's
 * table carries five more columns — Read back, Warnings, Failed, Open and
 * Est. min saved — and a two-letter workflow code. `ActivityWorkflowTotal`
 * serves `{workflowId, registration, runs}` and nothing else, so those columns
 * have no denominator here. Printing them as zeros would be the exact
 * plausible-but-wrong number a supervisor quotes.
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
            ? workflow.registration.label
            : <span className="text-[color:var(--ds-status-waiting-fg)]">{workflow.workflowId}</span>,
        runs: workflow.runs,
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
      <SectionLabel className="mb-[var(--ds-space-snug)]">By workflow</SectionLabel>
      <div className="overflow-x-auto">
        <Table label="Activity by workflow, grouped by category">
          <THead>
            <TR>
              <TH>Workflow</TH>
              <TH align="right">Runs</TH>
              <TH align="right">Share</TH>
            </TR>
          </THead>
          {blocks.map((block) => (
            <CategoryBody
              key={block.key}
              label={block.label}
              workflows={block.workflows}
              subtotalRuns={block.subtotalRuns}
              total={report.totalRuns}
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
function OutstandingTable({ report }: { report: ActivityReportWire }) {
  const buckets = OUTSTANDING_ORDER.map((status) => ({ status, runs: statusRuns(report, status) })).filter(
    (bucket) => bucket.runs > 0,
  );
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
            </TR>
          </THead>
          <TBody>
            {buckets.map((bucket) => (
              <TR key={bucket.status}>
                <TD>
                  <StatusPill status={dsStatusOf(bucket.status)} size="sm" />
                </TD>
                <TD align="right" numeric>
                  {bucket.runs}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function ActivityBody({ report }: { report: ActivityReportWire }) {
  const readBack = statusRuns(report, "done");
  const withWarnings = statusRuns(report, "partial");
  const failedRuns = statusRuns(report, "failed");
  const errorRatePct =
    report.terminalRuns === 0 ? 0 : Math.round((failedRuns / report.terminalRuns) * 1000) / 10;

  return (
    <div className="flex flex-col gap-[var(--ds-space-cozy)]">
      {/* ---- headline tiles. Counterweights first: OUTSTANDING sits in the
               row, not under it, so finished work is never read without the
               work that is not. ---- */}
      <div className="grid grid-cols-2 gap-[var(--ds-space-base)] min-[1080px]:grid-cols-4">
        <Tile
          label="Runs"
          value={String(report.totalRuns)}
          note={`${plural(report.days.length, "day")} with runs in this span`}
        />
        {/*
          FINISHED IS THE WORK THAT SUCCEEDED, not everything that stopped —
          the demo's `verified + warnings`, which here is the `done` and
          `partial` statuses through the ONE wire→ds map (`done` → verifiedDone,
          `partial` → doneWarnings). Using `terminalRuns` would put a span whose
          runs mostly FAILED under a headline reading "34 finished", with a note
          underneath summing to nine. The tile and its own note now describe the
          same set, and the failures are one tile to the right.
        */}
        <Tile
          label="Finished"
          value={String(readBack + withWarnings)}
          note={`${String(readBack)} read back · ${String(withWarnings)} with warnings`}
        />
        {/* The amber paragraph the demo replaced is GONE here too. What it was
            carrying is a NUMBER — how much is still open — and a reason, which
            is the same on every report and therefore belongs in the ⓘ. */}
        <Tile
          label="Still open"
          value={String(report.inFlightRuns)}
          note={
            report.inFlightRuns > 0
              ? "counted in neither the error rate nor the outcome totals"
              : "nothing in this span is still open"
          }
          tone={report.inFlightRuns > 0 ? "warning" : "default"}
          info={
            <BulletList
              items={[
                "A run that has not ended has not succeeded or failed, so it is excluded from the error rate rather than counted as either.",
                "It is reported here, beside finished work, so a busy span cannot read as a finished one.",
                "The states below say what each open run is waiting on, in the same vocabulary the queue uses.",
              ]}
            />
          }
        />
        <Tile
          label="Error rate"
          value={`${String(errorRatePct)}%`}
          note={`${String(failedRuns)} failed of ${String(report.terminalRuns)} terminal runs`}
          tone={errorRatePct > 15 ? "warning" : "default"}
        />
      </div>

      {/* ---- what is still open, and what it is waiting ON ---- */}
      <OutstandingTable report={report} />

      {/* ---- per workflow, grouped by the served category axis ---- */}
      <WorkflowsByCategory report={report} />

      {/* ---- how long they took, WITH the runs nobody measured ---- */}
      <div className="flex flex-col gap-[var(--ds-space-snug)]">
        <SectionLabel>How long they took</SectionLabel>
        <MetaLine
          items={[
            report.durations.medianMs.state === "present"
              ? `median ${ms(report.durations.medianMs.value)}`
              : report.durations.medianMs.reason,
            report.durations.longestMs.state === "present"
              ? `longest ${ms(report.durations.longestMs.value)}`
              : report.durations.longestMs.reason,
            `${String(report.durations.measuredRuns)} measured`,
          ]}
        />
        {report.durations.unmeasuredRuns > 0 && (
          <span className={cn(dsText.meta, "flex items-center gap-[var(--ds-space-hair)] text-[color:var(--ds-status-waiting-fg)]")}>
            <TriangleAlert aria-hidden className={dsIcon.sm} />
            {report.durations.unmeasuredRuns} finished {report.durations.unmeasuredRuns === 1 ? "run has" : "runs have"} no
            recorded end instant, so {report.durations.unmeasuredRuns === 1 ? "it is" : "they are"} excluded from every
            duration above rather than counted as zero.
          </span>
        )}
      </div>

      <ShareTable
        label="By day"
        total={report.totalRuns}
        rows={report.days.map((day) => ({ key: day.day, label: day.day, runs: day.runs }))}
      />

      {/*
        No per-row hue here, on purpose. `ActivityOutcome` has seven arms and
        the ds status vocabulary has eight with a different partition —
        `superseded`, `discarded` and `interrupted` have no status of their own,
        so tinting them would be this surface inventing a second colour map
        beside `status.tsx`. The neutral accent says "share of terminal runs",
        which is exactly what the column measures.
      */}
      <ShareTable
        label="By outcome"
        total={report.terminalRuns}
        rows={report.outcomes.map((outcome) => ({
          key: outcome.outcome,
          label: outcome.outcome,
          runs: outcome.runs,
        }))}
      />

      <div className="min-w-0">
        <SectionLabel className="mb-[var(--ds-space-snug)]">Failures</SectionLabel>
        {report.failures.length === 0 ? (
          <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
            No run in this range settled with a structured failure.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table label="Failures by code">
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH align="right">Runs</TH>
                  <TH align="right">Transient</TH>
                  <TH>Examples</TH>
                </TR>
              </THead>
              <TBody>
                {report.failures.map((failure) => (
                  <TR key={failure.code}>
                    <TD numeric>{failure.code}</TD>
                    <TD numeric align="right">{failure.runs}</TD>
                    <TD numeric align="right">{failure.transient}</TD>
                    <TD numeric>{failure.sample.join(" ")}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The caveats behind the ⓘ in the panel header.
 *
 * This is the artifact that leaves the operator's screen, so the rules it was
 * counted by have to be reachable FROM it. The demo's five bullets are three
 * here: the two it drops (hours saved, distinct people) name figures this wire
 * does not carry, and a caveat about a number that is not on the page is noise.
 */
function caveatsFor(report: ActivityReportWire): string[] {
  return [
    "Error rate counts only runs that reached a terminal state. Anything queued, running, waiting on you or blocked is excluded and reported separately as still open, so a busy span cannot read as a finished one.",
    `${plural(report.inFlightRuns, "run")} ${report.inFlightRuns === 1 ? "is" : "are"} still open in this span, and that work is represented in no total on this page except its own.`,
    "Every total here is a rendering of the one run/queue projection the Queue Panel reads. Hidden and archived runs are excluded once, inside it, so this report and the day it summarises cannot disagree.",
  ];
}

export function ActivityReport({
  range,
  today,
  actorId,
  appVersion,
  onRange,
}: {
  /** the `from..to` value carried by the URL */
  range: string;
  today: string;
  /** who is reading it — a report leaves the screen, so it says who made it */
  actorId: string;
  appVersion: string;
  onRange: (next: string) => void;
}) {
  const client = useDashboardClient();
  const enter = useDsEnterTransition();
  const resolved = useMemo(() => parseActivityRange(range, today), [range, today]);
  const [resource, setResource] = useState<AsyncResource<ActivityReportWire>>(LOADING);

  useEffect(() => {
    let live = true;
    setResource(LOADING);
    client.activityReport(resolved.from, resolved.to).then(
      (value) => { if (live) setResource(loaded(value)); },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) { setResource(failed(error)); return; }
        throw error;
      },
    );
    return () => { live = false; };
  }, [client, resolved.from, resolved.to]);

  const spanLabel = activityRangeLabel(resolved.from, resolved.to);
  const report = resource.state === "loaded" ? resource.value : undefined;

  return (
    <Panel
      {...enter}
      aria-label="Activity report"
      className={cn(
        "flex-1 data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      {/* NO `back` BUTTON, deliberately — ported from the demo's own rule.
          Operator, of this surface: *"no need to have this back to dashboard in
          activity."* It was a duplicate door: the product switcher sits above
          this header on every view, it holds the Activity entry that got you
          here, and the ← / → history pair returns you to the exact place you
          left. Archive and Explorer KEEP theirs — the rule is not arbitrary,
          those are opened FROM somewhere; this one is a destination in the nav. */}
      <PageHeader
        title="Activity report"
        icon={<ChartNoAxesColumn aria-hidden className={dsIcon.lg} />}
        actions={
          /* THE SPAN CONTROL LIVES ON THE PAGE'S OWN BAR, above the sentence
             that reports it. The demo offers two fixture spans as chips; the
             served wire requires both bounds by name (D180) and defaults
             nothing, so the two bounds themselves are the control. */
          <span className="flex items-end gap-[var(--ds-space-snug)]">
            <Field label="From">
              <Input
                type="date"
                value={resolved.from}
                max={resolved.to}
                onChange={(event) => onRange(activityRangeValue({ ...resolved, from: event.target.value }))}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={resolved.to}
                min={resolved.from}
                onChange={(event) => onRange(activityRangeValue({ ...resolved, to: event.target.value }))}
              />
            </Field>
          </span>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-[var(--ds-space-cozy)]">
        <Panel>
          <PanelHeader
            title="Automation activity"
            subtitle={spanLabel}
            meta={report === undefined ? undefined : plural(report.totalRuns, "run")}
            actions={
              report === undefined ? undefined : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="ghost" icon={<Info aria-hidden className={dsIcon.md} />}>
                      How it is counted
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent title="How this report is counted" width="lg" align="end">
                    <BulletList items={caveatsFor(report)} />
                  </PopoverContent>
                </Popover>
              )
            }
          />
          <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
            {resource.state === "loading" || resource.state === "idle" ? (
              <Skeleton className="h-64 w-full" />
            ) : resource.state === "failed" ? (
              <Refusal
                title="The activity report could not be built"
                code="activity-read-failed"
                outcome="Nothing was changed; this surface only reads."
              >
                <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{resource.error.message}</p>
              </Refusal>
            ) : resource.value.totalRuns === 0 ? (
              <Well>
                <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                  No run started between {resource.value.from} and {resource.value.to}. Archived runs are deliberately
                  not counted here — they left the live surfaces when their version bumped, and the Archive is where
                  they are read.
                </p>
              </Well>
            ) : (
              <ActivityBody report={resource.value} />
            )}
          </PanelBody>
          {/* PROVENANCE, not a defence of the design. The caveats are one press
              away in the header's ⓘ — this is the artifact that leaves the
              operator's screen, so they have to be reachable from it — and the
              footer states who made it, when, and out of what. */}
          <PanelFooter>
            <MetaLine
              items={[
                report === undefined ? `${spanLabel} — not yet generated` : `generated ${fmtClock(report.generatedAt)}`,
                actorId,
                `app ${appVersion}`,
                spanLabel,
                report === undefined ? undefined : plural(report.totalRuns, "run"),
              ].filter((item): item is string => item !== undefined)}
            />
          </PanelFooter>
        </Panel>
      </div>
    </Panel>
  );
}
