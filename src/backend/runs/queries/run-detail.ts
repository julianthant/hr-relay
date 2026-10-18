// Serve each section through its own evidence state; absent sections never look like empty successful reads.
import { readTimelineRecords } from "../../storage/events/timeline-reader.js";
import type { NativeRunEventWire } from "../../../models/dashboard/run-detail.js";
import { availableSections, buildRunGate } from "./run-trust.js";
import { readRunCaptureAvailability } from "./run-captures.js";
import {
  RunDetailWireSchema,
  TimelineStepWireSchema,
  NativeRunEventWireSchema,
  type RunDetailWire,
  type RunCaptureAvailabilityWire,
  type TimelineDuration,
  type TimelineStepWire,
} from "../../../models/dashboard/run-detail.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { SubjectCheckpointSource } from "../projections/run-subject-title.js";
import type { RunRecord } from "../../../models/run/record.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import type { RunFoldRecord } from "../projections/run-queue-projection.js";
import { resolveSubjectTitle } from "../projections/run-subject-title.js";
import { deterministicUuid, nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import { deriveRunStatus, foldCategoryState, panelKindOf, taskStateOf, type TaskSpanOutcome } from "../lifecycle/run-status.js";
import {
  ProjectionDegradedError,
  LogIdentityRefusedError,
} from "../commands/refusals.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView } from "./run-detail-types.js";
import { requireCanonicalRun } from "./run-read.js";
import { assertRunTimelineCompatible } from "./run-timeline-compatibility.js";

export { availableSections } from "./run-trust.js";
export { buildRunSection, readRunSection } from "./run-sections.js";
export { createRunNoteScanCache } from "./run-logs.js";
export type { RunLogScanEntry, RunNoteScanEntry, RunNoteScanCache } from "./run-logs.js";
export type {
  RunDetailTrustDeps,
  RunDetailGateNodeView,
  RunDetailWriteContractView,
  RunDetailDataOriginView,
  RunDetailDescriptorView,
  RunDetailQueryDeps,
} from "./run-detail-types.js";


function spanDuration(span: Readonly<{ startedAt?: string; endedAt?: string }>): TimelineDuration {
  if (span.endedAt === undefined) {
    return { state: "absent", reason: "this step has not ended; its span carries no end instant yet" };
  }
  if (span.startedAt === undefined) {
    return { state: "absent", reason: "no span.started was folded for this step, so it has no start instant to measure from" };
  }
  const started = Date.parse(span.startedAt);
  const ended = Date.parse(span.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return { state: "absent", reason: `this step's span instants are not both readable (${span.startedAt} → ${span.endedAt})` };
  }
  if (ended < started) {
    return { state: "absent", reason: `this step's span ended before it started (${span.startedAt} → ${span.endedAt}); the instants disagree` };
  }
  return { state: "present", ms: ended - started };
}



type TimelineStepState = TimelineStepWire["state"];

type TimelineNotRunReason = NonNullable<TimelineStepWire["members"][number]["notRunReason"]>;


function spanNotRunReason(
  span: Readonly<{ outcome?: TaskSpanOutcome; notRunReason?: TimelineNotRunReason }> | undefined,
  nodeId: string | undefined,
): TimelineNotRunReason | undefined {
  const reason = span?.notRunReason;
  if (reason === undefined) return undefined;
  const state = taskStateOf(span?.outcome);
  if (state !== "skipped") {
    throw new ProjectionDegradedError(
      `${nodeId === undefined ? "a task span with no resolvable node" : `node "${nodeId}"`} recorded the `
      + `not-run reason "${reason}" and an outcome this projection folds to "${state}"; a span cannot both `
      + "have not run and have finished, and this projection will not choose which half to draw",
    );
  }
  return reason;
}


function replaySourceOf(
  checkpoints: SubjectCheckpointSource,
  authority: RunRecord,
  nodeId: string,
): { attempt: number; claimGeneration?: number } | undefined {
  const { lifecycle } = authority;
  if (lifecycle.state !== "terminal" || lifecycle.outcome !== "done") return undefined;
  const stored = checkpoints.latestCheckpoint(
    authority.envelope.workflow,
    authority.envelope.itemId,
    nodeId,
  );
  if (stored === undefined) return undefined;
  if (stored.runId === authority.envelope.runId) return undefined;
  return {
    attempt: stored.attempt,
    ...(stored.claimGeneration === undefined ? {} : { claimGeneration: stored.claimGeneration }),
  };
}


function buildTimelineSteps(
  timeline: NonNullable<RunDetailDescriptorView["timeline"]>,
  row: RunFoldRecord,
  runTerminal: boolean,
  replaySource: (nodeId: string) => { attempt: number; claimGeneration?: number } | undefined,
): TimelineStepWire[] {
  type SpanFold = RunFoldRecord["taskSpans"][number];
  const spansByNode = new Map<string, SpanFold[]>();
  for (const span of row.taskSpans) {
    const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
    if (nodeId === undefined) continue;
    const bucket = spansByNode.get(nodeId);
    if (bucket === undefined) spansByNode.set(nodeId, [span]);
    else bucket.push(span);
  }

  const memberOf = (node: Readonly<{ id: string; label: string }>): {
    nodeId: string;
    label: string;
    state: TimelineStepState;
    durationMs?: number;
    executions: number;
    replayedFrom?: { attempt: number; claimGeneration?: number };
    notRunReason?: TimelineNotRunReason;
  } => {
    const executions = spansByNode.get(node.id) ?? [];
    if (executions.length === 0) {
      // A gate owns no task span; its category presence IS its state.
      if (row.openGates.some((gate) => gate.gate === node.id)) {
        return { nodeId: node.id, label: node.label, state: "blocked", executions: 0 };
      }
      if (row.resolvedGates.some((gate) => gate.gate === node.id)) {
        return { nodeId: node.id, label: node.label, state: "done", executions: 0 };
      }

      const replayedFrom = replaySource(node.id);
      if (replayedFrom !== undefined) {
        return { nodeId: node.id, label: node.label, state: "replayed", executions: 0, replayedFrom };
      }
      return { nodeId: node.id, label: node.label, state: "pending", executions: 0 };
    }
    const ordered = [...executions].sort((a, b) =>
      (a.startedAt ?? a.endedAt ?? "").localeCompare(b.startedAt ?? b.endedAt ?? ""));
    const latest = ordered[ordered.length - 1];
    const state: TimelineStepState = taskStateOf(latest?.outcome);

    const notRunReason = spanNotRunReason(latest, node.id);
    let ms = 0;
    let measured = false;
    for (const span of executions) {
      const duration = spanDuration(span);
      if (duration.state === "present") {
        ms += duration.ms;
        measured = true;
      }
    }
    return {
      nodeId: node.id,
      label: node.label,
      state,
      ...(measured ? { durationMs: ms } : {}),
      executions: executions.length,
      ...(notRunReason === undefined ? {} : { notRunReason }),
    };
  };

  return timeline.map((category) => {
    const members = category.nodes.map(memberOf);
    const measured = members.filter((member) => member.durationMs !== undefined);
    const totalMs = measured.reduce((sum, member) => sum + (member.durationMs ?? 0), 0);
    const maxExecutions = Math.max(...members.map((member) => member.executions));
    return TimelineStepWireSchema.parse({
      key: category.key,
      label: category.label,
      ...(category.system === undefined ? {} : { system: category.system }),
      state: foldCategoryState(members.map((member) => member.state), runTerminal),
      ...(measured.length > 0 ? { durationSec: Math.round(totalMs / 1000) } : {}),
      ...(maxExecutions >= 2 ? { executions: maxExecutions } : {}),
      members: members.map((member) => ({
        nodeId: member.nodeId,
        categoryKey: category.key,
        label: member.label,
        state: member.state,
        ...(member.durationMs === undefined ? {} : { durationSec: Math.round(member.durationMs / 1000) }),
        ...(member.replayedFrom === undefined ? {} : { replayedFrom: member.replayedFrom }),
        ...(member.notRunReason === undefined ? {} : { notRunReason: member.notRunReason }),
      })),
    });
  });
}

export function buildRunDetail(
  deps: RunDetailQueryDeps,
  runId: string,
  captures?: RunCaptureAvailabilityWire,
): RunDetailWire {
  const { row, authority } = requireCanonicalRun(deps, runId);
  const status = deriveRunStatus(authority);
  const descriptorView = deps.descriptors.resolve(authority.envelope.workflow);
  let retainedCheckpoints: readonly RunCheckpointRecord[] | undefined;
  const readCheckpoints = () => retainedCheckpoints ??= deps.authority.listCheckpoints(authority.envelope.workflow, authority.envelope.itemId);
  let latestByNode: Map<string, RunCheckpointRecord> | undefined;
  const checkpoints: SubjectCheckpointSource = {
    latestCheckpoint: (_workflowId, _itemId, nodeId) => {
      if (latestByNode === undefined) {
        latestByNode = new Map();
        for (const checkpoint of readCheckpoints()) {
          const latest = latestByNode.get(checkpoint.nodeId);
          if (latest === undefined || checkpoint.attempt > latest.attempt
            || checkpoint.attempt === latest.attempt && checkpoint.claimGeneration > latest.claimGeneration) {
            latestByNode.set(checkpoint.nodeId, checkpoint);
          }
        }
      }
      return latestByNode.get(nodeId);
    },
  };
  if (descriptorView?.timeline?.some(category => category.key === undefined)) {
    throw new LogIdentityRefusedError("timeline category identity is missing");
  }
  const olderDescriptor = descriptorView?.version !== authority.envelope.descriptorVersion
    || descriptorView?.contractFingerprint !== authority.envelope.contractFingerprint;
  const skipTimeline = row !== undefined && row.taskSpans.length === 0 && row.openGates.length === 0 && row.resolvedGates.length === 0;
  const nativeRecords = skipTimeline
    ? []
    : readTimelineRecords(deps.timeline, 0, runId).records;
  if (olderDescriptor) assertRunTimelineCompatible(authority, descriptorView?.timeline, {
    timeline: deps.timeline, authority: { listCheckpoints: readCheckpoints, listGateResults: id => deps.authority.listGateResults(id) },
  }, row, skipTimeline ? undefined : nativeRecords);
  const nativeOf = (record: (typeof nativeRecords)[number], nodeId?: string): NativeRunEventWire => {
    if (record.payload.kind !== "span" || !("runId" in record.payload.event)) throw new LogIdentityRefusedError("timeline event has no run identity");
    const event = record.payload.event;
    if (event.runId !== runId || event.traceId !== authority.envelope.traceId || event.attempt > authority.envelope.attempt) {
      throw new LogIdentityRefusedError("timeline event identity contradicts run authority");
    }
    return NativeRunEventWireSchema.parse({ eventId: record.eventId, order: record.cursor, runId: event.runId, traceId: event.traceId,
      attempt: event.attempt, spanPath: event.spanPath, ...(nodeId === undefined ? {} : { nodeId }) });
  };
  const categoryOf = (nodeId: string | undefined) => {
    if (descriptorView?.timeline === undefined) return undefined;
    const matches = descriptorView.timeline.filter(category => category.nodes.some(node => node.id === nodeId));
    if (matches.length !== 1) throw new LogIdentityRefusedError("timeline node has no unique declared category");
    const match = matches[0];
    if (match === undefined) throw new LogIdentityRefusedError("timeline category identity is missing");
    return match.key;
  };
  const omittedSteps = [...new Set(
    (authority.envelope.stepOmissions ?? []).map((entry) => String(entry.step)),
  )].sort();

  const timelineEvents: {
    at: string;
    label: string;
    state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled" | "skipped";
    notRun: { state: "absent"; reason: string } | { state: "present"; reason: "condition-false" | "branch-not-selected" | "operator-asserted" | "step-omitted" };
    durationMs: TimelineDuration;
    seed: string;
    native: NativeRunEventWire;
    categoryKey?: string;
  }[] = [];
  // A gate has no measured task span; its duration is unknown even when a decision exists.
  const gateDuration = {
    state: "absent",
    reason: "a gate is not a task span; the executor measures no duration for it",
  } as const;
  for (const span of row?.taskSpans ?? []) {
    const state = taskStateOf(span.outcome);
    // A skip without its recorded reason cannot imply a guarded condition or cancellation.
    const spanReason = spanNotRunReason(span, nodeIdOfTaskSpanPath(span.spanPath));
    const notRun = state !== "skipped"
      ? { state: "absent", reason: "this step ran" } as const
      : spanReason === undefined
        ? { state: "absent", reason: "this step did not run; its span recorded no reason" } as const
        : { state: "present", reason: spanReason } as const;
    const record = nativeRecords.find(record => record.eventId === span.nativeEventId);
    if (record?.payload.kind !== "span" || !("runId" in record.payload.event)
      || record.payload.event.spanPath !== span.spanPath || record.payload.event.attempt !== span.attempt) {
      throw new LogIdentityRefusedError("task span has no exact native event identity");
    }
    const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
    timelineEvents.push({
      native: nativeOf(record, nodeId),
      categoryKey: categoryOf(nodeId),
      at: span.startedAt ?? span.endedAt ?? authority.envelope.enqueuedAt,
      label: span.name,
      state,
      notRun,
      durationMs: spanDuration(span),
      seed: record.eventId,
    });
  }
  const gateNotRun = { state: "absent", reason: "a gate is not a workflow step" } as const;
  for (const record of nativeRecords) {
    if (record.payload.kind !== "span") continue;
    const event = record.payload.event;
    if (event.t !== "gate.opened" && event.t !== "gate.resolved") continue;
    timelineEvents.push({ at: event.ts, label: `gate:${event.gate}`, state: event.t === "gate.opened" ? "blocked" : "done",
      notRun: gateNotRun, durationMs: gateDuration, seed: record.eventId,
      native: nativeOf(record, event.gate), categoryKey: categoryOf(event.gate) });
  }
  timelineEvents.sort((a, b) => a.native.order - b.native.order);
  const timelineWire = timelineEvents.map(event => ({
    noteId: deterministicUuid(`timeline:${runId}:${event.seed}`),
    sequence: event.native.order,
    native: event.native,
    categoryKey: event.categoryKey,
    at: event.at,
    label: event.label,
    state: event.state,
    notRun: event.notRun,
    durationMs: event.durationMs,
  }));

  const gate = buildRunGate(deps, runId, row, authority);

  const { lifecycle } = authority;

  const rehearsed = lifecycle.state === "terminal"
    && lifecycle.outcome === "done"
    && authority.envelope.dryRun;
  // Omitted steps cannot claim measured execution or verified workflow completion.
  const omitted = lifecycle.state === "terminal"
    && lifecycle.outcome === "done"
    && omittedSteps.length > 0;
  const outcome = lifecycle.state === "terminal"
    ? lifecycle.outcome === "interrupted"
      ? { state: "absent", reason: "run interrupted; ref write-safety recovery will requeue or settle it" }
      : {
        state: "terminal",
        result: rehearsed || omitted
          ? "partial"
          : ({ done: "verified-done", failed: "failed", cancelled: "cancelled", discarded: "cancelled", superseded: "cancelled" } as const)[lifecycle.outcome],
        completedAt: lifecycle.endedAt,
        ...(rehearsed ? { rehearsal: true } : {}),
      }
    : { state: "absent", reason: `run is ${status}` };

  return RunDetailWireSchema.parse({
    runId,
    rowRevision: authority.version,
    panelKind: panelKindOf(authority.envelope.shape),
    header: {
      runId,
      traceId: authority.envelope.traceId,
      workflowId: authority.envelope.workflow,
      ...(row === undefined ? {} : { actorId: row.queued.actorId }),

      title: (retainedRunProtectedBindings(authority).length > 0 ? undefined : authority.displayName)
        ?? (descriptorView?.titleProjection === undefined ? undefined : deps.projection.queueSurface(runId)?.title)
        ?? resolveSubjectTitle(
          descriptorView?.subjectProjection,
          { workflowId: authority.envelope.workflow, itemId: authority.envelope.itemId },
          checkpoints,
        )
        ?? row?.queued.title ?? authority.envelope.runId,
      status,
      attempt: authority.envelope.attempt,
    },
    timeline: {
      events: timelineWire,

      ...(descriptorView?.timeline === undefined || row === undefined
        ? {}
        : {
          steps: buildTimelineSteps(
            descriptorView.timeline,
            row,
            authority.lifecycle.state === "terminal",
            (nodeId) => replaySourceOf(checkpoints, authority, nodeId),
          ),
        }),
    },
    gate,
    outcome,
    context: {
      // Every done task recorded provenance-validated data (1f mandate); the
      // evidence service is 2g, so its count is genuinely zero today.
      dataFacts: row?.taskSpans.filter((span) => span.outcome === "done").length ?? 0,
      evidenceFacts: 0,
      attempts: authority.envelope.attempt,
    },
    ...(captures === undefined ? {} : { captures }),

    ...(omittedSteps.length === 0 ? {} : { omittedSteps }),
    availableSections: availableSections(row, authority, deps.trust, captures),
  });
}

/** The live route adds async capture verification; Archive's synchronous `buildRunDetail` freeze does not inspect that authority. */
export async function readRunDetail(
  deps: RunDetailQueryDeps,
  runId: string,
  signal?: AbortSignal,
): Promise<RunDetailWire> {
  const captures = await readRunCaptureAvailability(deps, runId, signal);
  return buildRunDetail(deps, runId, captures);
}
