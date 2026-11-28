import { nodeIdOfTaskSpanPath } from "../../runs/lifecycle/support.js";
import {
  activityMedian,
  activityOutcomeClass,
  type ActivityDayTotal,
  type ActivityFailureStep,
  type ActivityMedianDuration,
  type ActivityOutcomeSplit,
} from "../../../models/dashboard/activity.js";
import { ErrorCodeSchema, NodeIdSchema, type NodeId } from "../../../rules/identity/ids.js";
import type { QueueStatusSchema } from "../../../models/dashboard/projection.js";
import type { z } from "zod";
import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { ActivityReportWireSchema, ACTIVITY_MEDIAN_ABSENT_REASON, ACTIVITY_SAMPLE_LIMIT,
  type ActivityAssistantUsage, type ActivityReportWire, type ActivityWorkflowTotal } from "../../../models/dashboard/activity.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../models/dashboard/activity-volume.js";
import { PACIFIC_TIME_ZONE } from "../../../models/dashboard/search-calendar.js";
import { TERMINAL_QUEUE_STATUSES } from "../../../models/dashboard/projection.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunSummary } from "../../../models/run/summary.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { activityTypicalTime, successfulActivityTiming } from "./activity-timing.js";

type QueueStatus = z.infer<typeof QueueStatusSchema>;

/** The Logs panel groups a node under its timeline category label, then the node label, then the span's recorded name. */
const NO_FAILED_SPAN = "the failed run has no task span that records the step where it failed";
const NO_NODE = "the failed task span does not name a workflow node";
const NO_TITLE = "the failed task span has no readable step title";

export type ActivityTaskSpan = {
  attempt: number;
  spanPath: string;
  name: string;
  startedAt?: string;
  endedAt?: string;
  outcome?: "done" | "failed" | "cancelled" | "discarded" | "skipped" | "interrupted" | "superseded";
};

type StepTimeline = readonly { label: string; nodes: readonly { id: string; label: string }[] }[];

function readableStepTitle(title: string, nodeId: string, spanPath: string): boolean {
  return title.length > 0 && title !== nodeId && title !== spanPath && !ErrorCodeSchema.safeParse(title).success;
}

/** A missing end sorts before every recorded instant. An offset and a `Z` instant compare as the same timeline. */
function endedInstant(span: ActivityTaskSpan): number {
  if (span.endedAt === undefined) return Number.NEGATIVE_INFINITY;
  const instant = Date.parse(span.endedAt);
  if (!Number.isFinite(instant)) throw new Error(`activity-failure-step-ended-at-invalid: ${span.spanPath}`);
  return instant;
}

function compareEndedAt(left: ActivityTaskSpan, right: ActivityTaskSpan): number {
  const leftInstant = endedInstant(left);
  const rightInstant = endedInstant(right);
  if (leftInstant !== rightInstant) return leftInstant < rightInstant ? -1 : 1;
  return left.spanPath.localeCompare(right.spanPath);
}

/** One failed run's step. The title is the one the Logs panel shows; the node id is only a key. */
export function failureStepOfTaskSpans(spans: readonly ActivityTaskSpan[], timeline: StepTimeline | undefined): { state: "known"; nodeId: NodeId; title: string } | { state: "unavailable"; reason: string } {
  const failed = spans.filter(span => span.outcome === "failed").sort(compareEndedAt);
  const span = failed.at(-1);
  if (span === undefined) return { state: "unavailable", reason: NO_FAILED_SPAN };
  const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
  const parsed = nodeId === undefined ? undefined : NodeIdSchema.safeParse(nodeId);
  if (parsed === undefined || !parsed.success) return { state: "unavailable", reason: NO_NODE };
  const categories = (timeline ?? []).filter(category => category.nodes.some(node => node.id === parsed.data));
  if (categories.length > 1) throw new Error("activity-failure-step-category-ambiguous");
  const category = categories[0];
  const node = category?.nodes.find(entry => entry.id === parsed.data);
  const title = [category?.label, node?.label, span.name].find(candidate => candidate !== undefined && readableStepTitle(candidate, parsed.data, span.spanPath));
  return title === undefined
    ? { state: "unavailable", reason: NO_TITLE }
    : { state: "known", nodeId: parsed.data, title };
}

type DayBucket = { runs: number; outcomes: ActivityOutcomeSplit; samples: number[] };
type WorkflowBucket = DayBucket & { days: Map<string, DayBucket>; steps: Map<string, ActivityFailureStep> };

function emptySplit(): ActivityOutcomeSplit {
  return { done: 0, failed: 0, attention: 0 };
}

function emptyDay(): DayBucket {
  return { runs: 0, outcomes: emptySplit(), samples: [] };
}

function dayWire(day: string, bucket: DayBucket): ActivityDayTotal {
  return { day, runs: bucket.runs, outcomes: bucket.outcomes, typicalTime: activityMedian(bucket.samples) };
}

function stepKey(step: { state: "known"; nodeId: NodeId; title: string } | { state: "unavailable"; reason: string }): string {
  return step.state === "known" ? `known\u0000${step.nodeId}\u0000${step.title}` : `unavailable\u0000${step.reason}`;
}

export type ActivityAnalyticsWorkflow = {
  outcomes: ActivityOutcomeSplit;
  days: ActivityDayTotal[];
  failedAt: ActivityFailureStep[];
  typicalMedian: ActivityMedianDuration;
};

/** Counts the Analytics fields from the same runs the activity report already visits. */
export function createActivityAnalytics() {
  const outcomeSplit = emptySplit();
  const days = new Map<string, DayBucket>();
  const workflows = new Map<string, WorkflowBucket>();
  const bucketFor = (workflowId: string): WorkflowBucket => {
    const existing = workflows.get(workflowId);
    if (existing !== undefined) return existing;
    const created: WorkflowBucket = { ...emptyDay(), days: new Map(), steps: new Map() };
    workflows.set(workflowId, created);
    return created;
  };
  return {
    observe(input: {
      workflowId: string;
      day: string;
      status: QueueStatus;
      lifecycleState: string;
      durationMs: number | null;
      failureStep?: { state: "known"; nodeId: NodeId; title: string } | { state: "unavailable"; reason: string };
    }): void {
      const workflow = bucketFor(input.workflowId);
      const reportDay = days.get(input.day) ?? emptyDay();
      const workflowDay = workflow.days.get(input.day) ?? emptyDay();
      reportDay.runs += 1;
      workflow.runs += 1;
      workflowDay.runs += 1;
      const outcome = activityOutcomeClass(input.status, input.lifecycleState);
      if (outcome !== undefined) {
        outcomeSplit[outcome] += 1;
        reportDay.outcomes[outcome] += 1;
        workflow.outcomes[outcome] += 1;
        workflowDay.outcomes[outcome] += 1;
      }
      if (input.durationMs !== null) {
        reportDay.samples.push(input.durationMs);
        workflow.samples.push(input.durationMs);
        workflowDay.samples.push(input.durationMs);
      }
      if (input.status === "failed") {
        const step = input.failureStep ?? { state: "unavailable" as const, reason: NO_FAILED_SPAN };
        const key = stepKey(step);
        const current = workflow.steps.get(key);
        workflow.steps.set(key, current === undefined ? { ...step, runs: 1 } : { ...current, runs: current.runs + 1 });
      }
      days.set(input.day, reportDay);
      workflow.days.set(input.day, workflowDay);
    },
    outcomeSplit(): ActivityOutcomeSplit {
      return outcomeSplit;
    },
    days(): ActivityDayTotal[] {
      return [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, bucket]) => dayWire(day, bucket));
    },
    workflow(workflowId: string): ActivityAnalyticsWorkflow {
      const workflow = workflows.get(workflowId);
      if (workflow === undefined) throw new Error("activity-analytics-workflow-missing");
      const failedAt = [...workflow.steps.values()].sort((left, right) => {
        if (left.state !== right.state) return left.state === "known" ? -1 : 1;
        if (left.state === "known" && right.state === "known") return left.nodeId.localeCompare(right.nodeId) || left.title.localeCompare(right.title);
        if (left.state === "unavailable" && right.state === "unavailable") return left.reason.localeCompare(right.reason);
        return 0;
      });
      return {
        outcomes: workflow.outcomes,
        days: [...workflow.days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, bucket]) => dayWire(day, bucket)),
        failedAt,
        typicalMedian: activityMedian(workflow.samples),
      };
    },
  };
}

export type ActivityReportRow = Parameters<ReturnType<typeof createActivityAnalytics>["observe"]>[0] & {
  runId: string;
  enqueuedAt: string;
  parentRunId: string | null;
  completion: keyof ActivityWorkflowCounts["completion"];
  terminal?: {
    outcome: Extract<RunRecord["lifecycle"], { state: "terminal" }>["outcome"];
    failure?: { code: string; transient: boolean };
  };
};

type ActivityWorkflowCounts = Omit<ActivityWorkflowTotal, "workflowId" | "registration" | "needsAttention" | "typicalTime" | "outcomes" | "days" | "failedAt" | "typicalMedian">;

function emptyActivityWorkflowCounts(): ActivityWorkflowCounts {
  return { runs: 0, completion: { readBack: 0, warnings: 0, warningsUnknown: 0 }, failed: 0, cancelled: 0, partial: 0, open: 0 };
}

const ACTIVITY_STATUS_BUCKET = { partial: "partial", done: "completion", failed: "failed", cancelled: "cancelled",
  blocked: "open", queued: "open", running: "open", cancelling: "open", "awaiting-approval": "open" } as const;

function bucketForInstant(buckets: readonly { start: string; endExclusive: string }[], instant: number): number {
  let low = 0;
  let high = buckets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Date.parse(buckets[middle].start) <= instant) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const bucket = buckets[index];
  if (bucket === undefined || instant >= Date.parse(bucket.endExclusive)) throw new Error("activity-volume-enqueue-outside-interval");
  return index;
}

export function buildActivityReport(input: {
  from: string;
  to: string;
  generatedAt: string;
  rows: Iterable<ActivityReportRow>;
  people: Iterable<RunSummary["person"]>;
  descriptors: { resolve(workflow: string): AnyWorkflowDescriptor | undefined };
  assistantUsage(): ActivityAssistantUsage;
  ledger(): ActivityReportWire["ledger"];
}): ActivityReportWire {
  const { from: start, to: end } = input;
  const volumeSkeleton = buildActivityVolumeBoundarySkeleton({ from: start, to: end }, PACIFIC_TIME_ZONE);
  const volumeCounts = volumeSkeleton.buckets.map(() => 0);
  const identities = new Set<string>();
  let evidenceRows = 0;
  let unavailableRows = 0;
  for (const person of input.people) {
    if (person.state === "available") {
      identities.add(person.identity);
      evidenceRows += 1;
    } else {
      unavailableRows += 1;
    }
  }
  const people = unavailableRows === 0
    ? { state: "present", distinct: identities.size, evidenceRows }
    : { state: "absent", evidenceRows, unavailableRows,
      reason: `${String(unavailableRows)} of ${String(evidenceRows + unavailableRows)} current Separations run/member rows lack validated canonical identity; distinct people is unavailable` };
  const workflows = new Map<string, ActivityWorkflowCounts>();
  const analytics = createActivityAnalytics();
  const statuses = new Map<string, { runs: number; sample: string[] }>();
  const outcomes = new Map<string, number>();
  const failures = new Map<string, { workflowId: string; code: string; runs: number; transient: number; sample: string[] }>();
  const measured: { runId: string; ms: number }[] = [];
  const timingRows: Pick<ActivityReportRow, "workflowId" | "status" | "parentRunId" | "durationMs">[] = [];
  const completion = { readBack: 0, warnings: 0, warningsUnknown: 0 };
  let unmeasured = 0;
  let terminalRuns = 0;

  for (const row of input.rows) {
    const { workflowId, runId, status, durationMs, terminal } = row;
    const enqueuedAt = Date.parse(row.enqueuedAt);
    if (!Number.isFinite(enqueuedAt)) throw new Error("activity-summary-enqueued-at-invalid");
    volumeCounts[bucketForInstant(volumeSkeleton.buckets, enqueuedAt)] += 1;
    timingRows.push({ workflowId, status, parentRunId: row.parentRunId, durationMs });

    const counts = workflows.get(workflowId) ?? emptyActivityWorkflowCounts();
    counts.runs += 1;
    workflows.set(workflowId, counts);

    const statusBucket = statuses.get(status) ?? { runs: 0, sample: [] };
    statusBucket.runs += 1;
    if (!TERMINAL_QUEUE_STATUSES.has(status) && statusBucket.sample.length < ACTIVITY_SAMPLE_LIMIT) statusBucket.sample.push(runId);
    statuses.set(status, statusBucket);

    const axis = ACTIVITY_STATUS_BUCKET[status];
    if (axis === "completion") {
      counts.completion[row.completion] += 1;
      completion[row.completion] += 1;
    } else {
      counts[axis] += 1;
    }

    analytics.observe(row);
    if (terminal === undefined) continue;
    terminalRuns += 1;
    outcomes.set(terminal.outcome, (outcomes.get(terminal.outcome) ?? 0) + 1);
    if (durationMs === null) unmeasured += 1;
    else measured.push({ runId, ms: durationMs });
    const { failure } = terminal;
    if (failure === undefined) continue;
    const key = JSON.stringify([workflowId, failure.code]);
    const bucket = failures.get(key) ?? { workflowId, code: failure.code, runs: 0, transient: 0, sample: [] };
    bucket.runs += 1;
    if (failure.transient) bucket.transient += 1;
    if (bucket.sample.length < ACTIVITY_SAMPLE_LIMIT) bucket.sample.push(runId);
    failures.set(key, bucket);
  }

  const categories = new Map<string, number>();
  let unregisteredCategoryRuns = 0;
  const workflowTotals = [...workflows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workflowId, counts]) => {
    const typicalTime = activityTypicalTime(successfulActivityTiming(workflowId, timingRows));
    const descriptor = input.descriptors.resolve(workflowId);
    if (descriptor === undefined) {
      unregisteredCategoryRuns += counts.runs;
      return {
        ...counts, ...analytics.workflow(workflowId), needsAttention: counts.failed, typicalTime,
        workflowId,
        registration: {
          state: "unregistered",
          reason: `workflow ${workflowId} is no longer registered; its label and category are unavailable`,
        },
      };
    }
    categories.set(descriptor.category, (categories.get(descriptor.category) ?? 0) + counts.runs);
    return {
      ...counts, ...analytics.workflow(workflowId), needsAttention: counts.failed, typicalTime,
      workflowId,
      registration: {
        state: "registered",
        label: descriptor.label,
        code: descriptor.code,
        categoryId: descriptor.category,
      },
    };
  });

  const sorted = [...measured].sort((a, b) => a.ms - b.ms);
  const longest = sorted.at(-1);
  const median = sorted.length === 0 ? undefined : sorted[Math.floor((sorted.length - 1) / 2)];
  const typicalMedian = activityMedian(measured.map(entry => entry.ms));
  if (volumeCounts.reduce((total, count) => total + count, 0) !== timingRows.length) throw new Error("activity-volume-count-mismatch");
  const volume = {
    state: "complete" as const,
    timeZone: volumeSkeleton.timeZone,
    granularity: volumeSkeleton.granularity,
    interval: volumeSkeleton.interval,
    coveredRuns: timingRows.length,
    buckets: volumeSkeleton.buckets.map((bucket, index) => ({ ...bucket, runs: volumeCounts[index] })),
  };

  return ActivityReportWireSchema.parse({
    wireVersion: 1,
    from: start,
    to: end,
    generatedAt: input.generatedAt,
    ...input.assistantUsage(),
    totalRuns: timingRows.length,
    terminalRuns,
    inFlightRuns: timingRows.length - terminalRuns,
    people,
    completion,
    outcomeSplit: analytics.outcomeSplit(),
    typicalMedian,
    volume,
    days: analytics.days(),
    workflows: workflowTotals,
    categories: [
      ...[...categories.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([categoryId, runs]) => ({ category: { state: "registered", categoryId }, runs })),
      ...(unregisteredCategoryRuns === 0 ? [] : [{
        category: { state: "unregistered", reason: "the workflows behind these runs are no longer registered" },
        runs: unregisteredCategoryRuns,
      }]),
    ],
    statuses: [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([status, bucket]) => ({ status, runs: bucket.runs, sample: bucket.sample })),
    outcomes: [...outcomes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([outcome, runs]) => ({ outcome, runs })),
    failures: [...failures.values()].sort((a, b) => a.workflowId.localeCompare(b.workflowId) || a.code.localeCompare(b.code))
      .map(bucket => ({ ...bucket, sentence: operatorFailureSentence(bucket.code),
        registration: workflowTotals.find(workflow => workflow.workflowId === bucket.workflowId)!.registration })),
    durations: {
      measuredRuns: measured.length,
      unmeasuredRuns: unmeasured,
      medianMs: median === undefined
        ? { state: "absent", reason: ACTIVITY_MEDIAN_ABSENT_REASON }
        : { state: "present", value: median.ms },
      longestMs: longest === undefined
        ? { state: "absent", reason: ACTIVITY_MEDIAN_ABSENT_REASON }
        : { state: "present", value: longest.ms, runId: longest.runId },
      totalMs: measured.reduce((total, entry) => total + entry.ms, 0),
    },

    ledger: input.ledger(),
  });
}
