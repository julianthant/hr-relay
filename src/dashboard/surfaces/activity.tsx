/**
 * The Activity report (doc 13 §5 "Activity", §6.7, D180).
 *
 * ## THESIS — a paragraph, then the shape of it
 *
 * The category default here is four KPI cards and a chart library, and both are
 * wrong for this surface. The operator is not monitoring a system: they are
 * answering "what did this thing do last month, and what did it cost" — a
 * question with a sentence for an answer. So the page opens with the sentence,
 * with the numbers set INTO it, and only then unfolds the same totals as
 * proportional rows. A bar whose width is the share and whose number is the
 * count says everything a bar chart would, in a table a screen reader can
 * read, with no chart runtime in a bundle that must stay free of Node built-ins
 * (doc 13 §8 guard #13).
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
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChartNoAxesColumn, TriangleAlert } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Button,
  Field,
  Input,
  MetaLine,
  PageHeader,
  Panel,
  PanelBody,
  Refusal,
  SectionLabel,
  Skeleton,
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
import { dsStatusOf } from "./status.js";
import type { DsStatus } from "../ds/ui.js";

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

function ms(value: number): string {
  if (value < 1000) return `${String(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${String(minutes)}m ${String(rest)}s`;
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
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>{label}</SectionLabel>
      <div className="overflow-x-auto">
        {/*
          Fixed columns, identical across every breakdown, so the five tables
          read as one measure taken five ways rather than five tables that
          happen to be stacked — the bars line up down the page and the eye can
          compare a day's share with a status's without re-anchoring.
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

function ActivityBody({ report }: { report: ActivityReportWire }) {
  /**
   * The status bar's own hue, read from the ONE status table rather than a
   * second colour map — the same rule the queue chip and the Status Bar pill
   * follow. `DsStatus` is camelCase and the token is kebab, which is the whole
   * translation this does.
   */
  const statusTone = (status: DsStatus): string =>
    `var(--ds-status-${status.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}-mark)`;

  if (report.totalRuns === 0) {
    return (
      <Well>
        <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
          No run started between {report.from} and {report.to}. Archived runs are deliberately not counted here —
          they left the live surfaces when their version bumped, and the Archive is where they are read.
        </p>
      </Well>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--ds-space-loose)]">
      {/*
        The sentence first. Numbers set into prose are read; numbers in four
        boxes are skimmed, and this page exists to be read.
      */}
      <p className={cn(dsText.title, "max-w-[65ch] text-[color:var(--ds-fg)]")}>
        <strong className="tabular-nums">{report.totalRuns}</strong>
        {report.totalRuns === 1 ? " run" : " runs"} started between {report.from} and {report.to}.{" "}
        <strong className="tabular-nums">{report.terminalRuns}</strong> finished
        {report.inFlightRuns > 0
          ? <> and <strong className="tabular-nums">{report.inFlightRuns}</strong> {report.inFlightRuns === 1 ? "is" : "are"} still in flight.</>
          : <>; none are still in flight.</>}
      </p>

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

      <ShareTable
        label="By workflow"
        total={report.totalRuns}
        rows={report.workflows.map((workflow) => ({
          key: workflow.workflowId,
          label: workflow.registration.state === "registered"
            ? workflow.registration.label
            : <span className="text-[color:var(--ds-status-waiting-fg)]">{workflow.workflowId}</span>,
          runs: workflow.runs,
        }))}
      />

      <ShareTable
        label="By category"
        total={report.totalRuns}
        rows={report.categories.map((category) => ({
          key: category.category.state === "registered" ? category.category.categoryId : "unregistered",
          label: category.category.state === "registered" ? category.category.categoryId : category.category.reason,
          runs: category.runs,
        }))}
      />

      <ShareTable
        label="By status"
        total={report.totalRuns}
        rows={report.statuses.map((status) => ({
          key: status.status,
          label: status.status,
          runs: status.runs,
          tone: statusTone(dsStatusOf(status.status)),
        }))}
      />

      <ShareTable
        label="By outcome"
        total={report.terminalRuns}
        rows={report.outcomes.map((outcome) => ({
          key: outcome.outcome,
          label: outcome.outcome,
          runs: outcome.runs,
        }))}
      />

      <div className="flex flex-col gap-[var(--ds-space-snug)]">
        <SectionLabel>Failures</SectionLabel>
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
                  <TH>Runs</TH>
                  <TH>Transient</TH>
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

      <p className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
        Every total here is a rendering of the one run/queue projection the Queue Panel reads, generated{" "}
        {report.generatedAt}. Hidden and archived runs are excluded once, inside it, so this report and the day it
        summarises cannot disagree.
      </p>
    </div>
  );
}

export function ActivityReport({
  range,
  today,
  onRange,
  onClose,
}: {
  /** the `from..to` value carried by the URL */
  range: string;
  today: string;
  onRange: (next: string) => void;
  onClose: () => void;
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

  return (
    <Panel
      {...enter}
      aria-label="Activity report"
      className={cn(
        "flex-1 data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <PanelBody>
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-base)]">
          <PageHeader
            title="Activity"
            icon={<ChartNoAxesColumn aria-hidden className={dsIcon.lg} />}
            back={
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowLeft aria-hidden className={dsIcon.sm} />}
                onClick={onClose}
              >
                Dashboard
              </Button>
            }
            actions={
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
          ) : (
            <ActivityBody report={resource.value} />
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
