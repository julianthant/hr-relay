import { nodeIdOfTaskSpanPath } from "../../runs/lifecycle/support.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
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

type TaskSpanEvent = {
  t: "span.started" | "span.ended";
  kind: string;
  attempt: number;
  spanPath: string;
  name?: string;
  ts: string;
  outcome?: ActivityTaskSpan["outcome"];
};

function taskSpanEvent(value: unknown): TaskSpanEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const event = value as { t?: unknown; kind?: unknown; attempt?: unknown; spanPath?: unknown; name?: unknown; ts?: unknown; outcome?: unknown };
  if ((event.t !== "span.started" && event.t !== "span.ended") || event.kind !== "task") return undefined;
  if (typeof event.attempt !== "number" || typeof event.spanPath !== "string" || typeof event.ts !== "string") {
    throw new Error("activity-task-span-invalid");
  }
  if (event.t === "span.started" && typeof event.name !== "string") throw new Error("activity-task-span-invalid");
  return {
    t: event.t,
    kind: event.kind,
    attempt: event.attempt,
    spanPath: event.spanPath,
    ...(typeof event.name === "string" ? { name: event.name } : {}),
    ts: event.ts,
    ...(typeof event.outcome === "string" ? { outcome: event.outcome as ActivityTaskSpan["outcome"] } : {}),
  };
}

/** The same task-span fold the queue projection keeps: a start records the name, and a close binds the last open span at that path. */
export function foldActivityTaskSpans(events: readonly { payload: { kind: string; event?: unknown } }[]): ActivityTaskSpan[] {
  const spans: ActivityTaskSpan[] = [];
  for (const record of events) {
    if (record.payload.kind !== "span") continue;
    const event = taskSpanEvent(record.payload.event);
    if (event === undefined) continue;
    if (event.t === "span.started") {
      spans.push({ attempt: event.attempt, spanPath: event.spanPath, name: event.name ?? event.spanPath, startedAt: event.ts });
      continue;
    }
    let span: ActivityTaskSpan | undefined;
    for (let index = spans.length - 1; index >= 0; index -= 1) {
      const candidate = spans[index];
      if (candidate === undefined || candidate.attempt !== event.attempt || candidate.spanPath !== event.spanPath || candidate.endedAt !== undefined) continue;
      span = candidate;
      break;
    }
    if (span === undefined) {
      span = { attempt: event.attempt, spanPath: event.spanPath, name: nodeIdOfTaskSpanPath(event.spanPath) ?? event.spanPath };
      spans.push(span);
    }
    span.endedAt = event.ts;
    span.outcome = event.outcome;
  }
  return spans;
}

export function taskSpansForRun(database: AuthorityDatabase, runId: string): ActivityTaskSpan[] {
  const events: { payload: { kind: string; event?: unknown } }[] = [];
  let after = 0;
  for (;;) {
    const page = database.authority.timelineEvents.page({ runId, after, limit: 1000 });
    events.push(...page);
    const last = page.at(-1);
    if (page.length < 1000 || last === undefined) break;
    after = last.cursor;
  }
  return foldActivityTaskSpans(events);
}

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
