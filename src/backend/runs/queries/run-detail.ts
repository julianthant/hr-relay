// Serve each section through its own evidence state; absent sections never look like empty successful reads.
import { z } from "zod";
import { ErrorCatalogCodeSchema, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import { WorkerBrowserObservationSchema, WorkerSetupRefusalCodeSchema } from "../../../models/run/worker-control.js";
import { WorkerPoolMemberSchema } from "../../../models/run/worker-slot.js";
import { BrowserSystemIdSchema, IsoInstantSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { WorkerActivitySchema, WorkerDirectiveSchema } from "../../runtime/workers/worker-messages.js";
import type { WorkerMemberView } from "../../runtime/workers/worker-pool.js";
import { readTimelineRecords } from "../../storage/events/timeline-reader.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { defineLaneRead, type DashboardReadLanes, type LaneReadContext, type LaneReadDefinition } from "../../storage/sqlite/dashboard-read-host.js";
import type { NativeRunEventWire } from "../../../models/dashboard/run-detail.js";
import type { ActionDescriptorWire } from "../../../models/dashboard/actions.js";
import type { RunDecisionWire } from "../../../models/dashboard/run-decision.js";
import { projectDecision, rowActionOption } from "../decisions/project-decision.js";
import { availableSections } from "./run-detail/availability.js";
import { buildRunGate } from "./run-detail/gate-park.js";
import { projectTypedSteps, type TypedStepView } from "./run-detail/typed-values.js";
import { readRunCaptureAvailability } from "./run-captures.js";
import { ocrChildRetryAvailable } from "../lifecycle/ocr-review-authority.js";
import { aggregateMemberRetryAvailable } from "./run-retry.js";
import { endedUnfinished, hostedOcrRun, offeredOcrReview } from "./ocr-record-members.js";
import {
  RunDetailWireSchema,
  RunCaptureAvailabilityWireSchema,
  RunDetailSectionResponseSchema,
  NotePageSchema,
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
import type { DelegationWaitState } from "../../../models/run/summary.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import type { RunFoldRecord } from "../projections/run-queue-projection.js";
import { resolveSubjectTitle } from "../projections/run-subject-title.js";
import { deterministicUuid, nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import { deriveRunStatus, foldCategoryState, panelKindOf, taskStateOf, type TaskSpanOutcome } from "../../../rules/runs/run-status.js";
import {
  ProjectionDegradedError,
  LogIdentityRefusedError,
  LogDisplayRefusedError,
  DiagnosticBundleCorruptError,
  DiagnosticBundleBytesMissingError,
  TargetNotFoundError,
} from "../commands/refusals.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView } from "./run-detail-types.js";
import { requireCanonicalRun, SectionNameSchema } from "./run-read.js";
import { assertRunTimelineCompatible, hasRunDescriptorDrift } from "./run-timeline-compatibility.js";
import { readDelegationCancellation } from "../../storage/sqlite/delegation-authority.js";
import type { RunPanel } from "../../../models/dashboard/subscription.js";
import { SectionUnavailableError } from "../commands/refusals.js";
import { requireTrustRun } from "../trust/run-reader.js";
import { buildRunLogsWhole, createRunNoteScanCache, type RunNoteScanCache } from "./run-logs.js";
import { buildRunSection, readRunSection } from "./run-sections.js";
import { readItemAttemptHistoryBody } from "./item-attempt-history.js";
import type { ItemAttemptHistoryRequest } from "../../../models/dashboard/item-attempt-history.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import { ProtectedSubjectDisplayRefusedError } from "../start/protected-input.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";

export { availableSections } from "./run-detail/availability.js";
export { buildRunSection, readRunSection } from "./run-sections.js";
export { resolveGateArmAnswer, resolveIdentityGateAnswer } from "./run-detail/gate-park.js";
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


/** Nodes whose latest span skipped a branch this run did not take; the served timeline leaves them out of both stages and events. */
function untakenBranchNodes(row: RunFoldRecord | undefined): ReadonlySet<string> {
  const latest = new Map<string, RunFoldRecord["taskSpans"][number]>();
  for (const span of row?.taskSpans ?? []) {
    const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
    if (nodeId === undefined) continue;
    const held = latest.get(nodeId);
    if (held === undefined || (held.startedAt ?? held.endedAt ?? "").localeCompare(span.startedAt ?? span.endedAt ?? "") <= 0) latest.set(nodeId, span);
  }
  return new Set([...latest].flatMap(([nodeId, span]) => {
    const reason = spanNotRunReason(span, nodeId);
    return reason === "condition-false" || reason === "branch-not-selected" ? [nodeId] : [];
  }));
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
  runCancelled: boolean,
  replaySource: (nodeId: string) => { attempt: number; claimGeneration?: number } | undefined,
  wait: DelegationWaitState | null | undefined,
  typed: ReadonlyMap<string, TypedStepView>,
  untaken: ReadonlySet<string>,
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

  const steps = timeline.flatMap((category) => {
    const members = category.nodes.filter(node => !untaken.has(node.id)).map(memberOf);
    if (members.length === 0) return [];
    const measured = members.filter((member) => member.durationMs !== undefined);
    const totalMs = measured.reduce((sum, member) => sum + (member.durationMs ?? 0), 0);
    const maxExecutions = Math.max(...members.map((member) => member.executions));
    return [TimelineStepWireSchema.parse({
      key: category.key,
      label: category.label,
      ...(category.system === undefined ? {} : { system: category.system }),
      state: wait != null && (category.key === wait.nodeId || category.nodes.some(node => node.id === wait.nodeId))
        ? wait.state === "blocked" ? "blocked" : "active" : foldCategoryState(members.map((member) => member.state), runTerminal),
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
      ...(category.key === undefined || members.every(member => member.notRunReason === "required-evidence-unavailable") ? {} : typed.get(category.key)),
    })];
  });
  if (runCancelled) {
    const unfinished = steps.find(step => ["pending", "active", "blocked", "cancelled"].includes(step.state));
    if (unfinished !== undefined) unfinished.state = "cancelled";
  }
  return steps;
}

export function buildRunDetail(
  deps: RunDetailQueryDeps,
  runId: string,
  captures?: RunCaptureAvailabilityWire,
): RunDetailWire {
  const { row, authority } = requireCanonicalRun(deps, runId);
  const delegationWait = deps.authority.delegationWait?.(runId);
  const status = deriveRunStatus({ ...authority, delegationWait });
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
  let timeline = descriptorView?.timeline;
  if (timeline?.some(category => category.key === undefined)) {
    throw new LogIdentityRefusedError("timeline category identity is missing");
  }
  const olderDescriptor = descriptorView?.version !== authority.envelope.descriptorVersion
    || descriptorView?.contractFingerprint !== authority.envelope.contractFingerprint;
  const skipTimeline = row !== undefined && row.taskSpans.length === 0 && row.openGates.length === 0 && row.resolvedGates.length === 0;
  const nativeRecords = skipTimeline
    ? []
    : readTimelineRecords(deps.timeline, 0, runId).records;
  if (olderDescriptor) {
    const historicalNodes = assertRunTimelineCompatible(authority, timeline, {
      timeline: deps.timeline, authority: { listCheckpoints: readCheckpoints, listGateResults: id => deps.authority.listGateResults(id) },
    }, row, skipTimeline ? undefined : nativeRecords, hasRunDescriptorDrift(authority, descriptorView));
    if (timeline !== undefined && historicalNodes.size > 0) {
      const keys = new Set(timeline.map(category => category.key));
      let key = "historical-steps";
      for (let suffix = 2; keys.has(key); suffix++) key = `historical-steps-${suffix}`;
      const labels = new Map(row?.taskSpans.map(span => [nodeIdOfTaskSpanPath(span.spanPath), span.name]));
      timeline = [...timeline, { key, label: "Historical steps",
        nodes: [...historicalNodes].map(id => ({ id, label: labels.get(id) ?? id })) }];
    }
  }
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
    if (timeline === undefined) return undefined;
    const matches = timeline.filter(category => category.nodes.some(node => node.id === nodeId));
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
    notRun: { state: "absent"; reason: string } | { state: "present"; reason: TimelineNotRunReason };
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
  const untaken = untakenBranchNodes(row);
  for (const span of row?.taskSpans ?? []) {
    const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
    if (nodeId !== undefined && untaken.has(nodeId)) continue;
    const state = taskStateOf(span.outcome);
    // A skip without its recorded reason cannot imply a guarded condition or cancellation.
    const spanReason = spanNotRunReason(span, nodeId);
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

  const canonical = deps.canonical;
  let cancellation: RunDetailWire["cancellation"];
  if (lifecycle.state === "terminal" && lifecycle.outcome === "cancelled") {
    const requestedBy = canonical !== undefined && canonical.database.authority.lifecycleJournal.findCancellation(runId) !== undefined
      ? readDelegationCancellation(canonical.database.authority, runId).cancelledBy : "unavailable";
    cancellation = { title: "Run cancelled", at: lifecycle.endedAt, requestedBy,
      outcome: requestedBy === "parent" ? "This run was cancelled when its parent was stopped."
        : requestedBy === "operator" ? "You cancelled this run." : "This run was cancelled." };
  }
  const review = canonical === undefined ? undefined : canonical.database.withAuthorityReadSnapshot(() => {
    const ocr = authority.envelope.workflow === "ocr" ? authority : hostedOcrRun(canonical.database.authority, authority);
    return ocr === undefined || endedUnfinished(authority) ? undefined : offeredOcrReview(canonical.database.authority, canonical.reader, ocr);
  });
  const reviewAvailable = review !== undefined;
  const childRetry = canonical === undefined || !(ocrChildRetryAvailable(canonical.database.authority, canonical.reader, authority,
      workflowId => canonical.descriptors.resolve(workflowId)) || aggregateMemberRetryAvailable(canonical.database.authority, canonical.reader, authority,
      workflowId => canonical.descriptors.resolve(workflowId))) ? undefined : {
    key: "retry-child", label: "Retry", kind: "command", command: "retry", expectedVersion: authority.version,
    intent: "neutral", icon: "retry", placement: ["banner"],
  };
  const surface = deps.projection.queueSurface(runId);
  const decision = runLevelDecision({ status, childRetryKey: childRetry?.key, paused: surface?.pauseControl?.state === "paused",
    stalled: lifecycle.state === "terminal" && lifecycle.outcome === "interrupted", rowActions: surface?.actions });
  return RunDetailWireSchema.parse({
    runId,
    rowRevision: authority.version,
    ...(review === undefined ? {} : { ocrRecordCount: review.revision.records.length }),
    ...(review === undefined || review.invalidatedCorrections.length === 0 ? {} : { ocrReviewChanges: review.invalidatedCorrections }),
    ...(childRetry === undefined ? {} : { childRetry }),
    ...(decision === undefined ? {} : { decision }),
    ...(authority.pause?.state === "paused" ? { pausedAt: authority.pause.pausedAt } : {}),
    ...((authority.claimGeneration !== 0 && timelineEvents.length > 0) || authority.pause?.state !== "paused" ? {}
      : { heldBeforeStart: { queuedAt: authority.envelope.enqueuedAt, pausedAt: authority.pause.pausedAt } }),
    panelKind: panelKindOf(authority.envelope.shape, reviewAvailable),
    header: {
      runId,
      ...(authority.envelope.parent === undefined ? {} : { parentRunId: authority.envelope.parent.runId }),
      ...(authority.envelope.retryOf === undefined ? {} : { retryOf: authority.envelope.retryOf }),
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

      ...(timeline === undefined || row === undefined
        ? {}
        : {
          steps: buildTimelineSteps(
            timeline,
            row,
            authority.lifecycle.state === "terminal",
            authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "cancelled",
            (nodeId) => replaySourceOf(checkpoints, authority, nodeId),
            delegationWait,
            // Canonical-backed like the review read: the typed values are read against the exact descriptor and its graph.
            canonical === undefined ? new Map() : projectTypedSteps(authority, canonical.descriptors.resolve(authority.envelope.workflow)),
            untaken,
          ),
        }),
    },
    gate,
    outcome,
    ...(cancellation === undefined ? {} : { cancellation }),
    context: {
      // Every done task recorded provenance-validated data (1f mandate); a settled delegation join records no checkpoint and observed nothing.
      // The evidence service is 2g, so its count is genuinely zero today.
      dataFacts: row?.taskSpans.filter((span) => span.outcome === "done"
        && readCheckpoints().some(checkpoint => checkpoint.runId === authority.envelope.runId && checkpoint.nodeId === nodeIdOfTaskSpanPath(span.spanPath))).length ?? 0,
      evidenceFacts: 0,
      attempts: authority.envelope.attempt,
    },
    ...(captures === undefined ? {} : { captures }),

    ...(omittedSteps.length === 0 ? {} : { omittedSteps }),
    availableSections: availableSections(row, authority, deps.trust, captures, reviewAvailable),
  });
}

/** The run-level decision: a failed member's own retry (D9), a cancel that has not settled (D16), a paused run (D13) or an interrupted one (D14); run controls send the queue row's own descriptors. */
export function runLevelDecision(facts: Readonly<{ status: string; childRetryKey?: string; paused: boolean; stalled: boolean; rowActions?: readonly ActionDescriptorWire[] }>): RunDecisionWire | undefined {
  if (facts.childRetryKey !== undefined) return projectDecision("member-failed", [{ id: "retry", send: { via: "action", actionKey: facts.childRetryKey } }]);
  if (facts.status === "cancelling") return projectDecision("cancelling", []);
  if (facts.paused) return projectDecision("paused", [...rowActionOption("resume", "resume", facts.rowActions), ...rowActionOption("cancel-run", "cancel", facts.rowActions)]);
  if (facts.stalled) {
    const rerun = facts.rowActions?.find(action => action.kind === "navigation" && action.navigate.kind === "rerun");
    const options = rowActionOption("cancel-run", "cancel", facts.rowActions);
    if (rerun !== undefined) options.unshift({ id: "rerun", send: { via: "row-action", actionKey: rerun.key } });
    return projectDecision("stalled", options);
  }
  return undefined;
}

const PANEL_SECTIONS = ["captures", "identity-gate", "parked-write", "failure", "workbook-writes"] as const;

const workerExitBase = {
  code: z.int().nullable(), signal: z.string().nullable(), at: IsoInstantSchema, settlement: z.enum(["settled", "failed"]),
};
const WorkerExitSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ ...workerExitBase, outcome: z.literal("stopped"), reason: z.enum(["operator", "shutdown", "logout", "reset", "remove", "fault"]).optional() }),
  z.strictObject({ ...workerExitBase, outcome: z.literal("crashed"), failureCode: ErrorCatalogCodeSchema.optional() }),
  z.strictObject({ ...workerExitBase, outcome: z.literal("setup-refused"), failureCode: WorkerSetupRefusalCodeSchema }),
]);
const WorkerMemberSchema = z.strictObject({
  member: WorkerPoolMemberSchema, lifetimeId: z.string().min(1), version: z.int().nonnegative(),
  state: z.enum(["starting", "running", "stopping", "exited"]), directive: WorkerDirectiveSchema,
  pid: z.int().positive().optional(), startedAt: IsoInstantSchema, activity: WorkerActivitySchema.optional(),
  browsers: z.array(WorkerBrowserObservationSchema), browserSystems: z.array(BrowserSystemIdSchema).optional(),
  exit: WorkerExitSchema.optional(), held: z.enum(["exit-unobserved", "kill-undelivered"]).optional(),
}).transform((view): WorkerMemberView => ({
  ...view, pid: view.pid, activity: view.activity, exit: view.exit, held: view.held,
}));
const ProcessFactsSchema = z.strictObject({ operatorName: z.string(), workers: z.array(WorkerMemberSchema) });
type ProcessFacts = z.output<typeof ProcessFactsSchema>;

const RunReadRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("detail"), runId: RunIdSchema, captures: RunCaptureAvailabilityWireSchema }),
  z.strictObject({ kind: z.literal("section"), runId: RunIdSchema, section: SectionNameSchema, cursor: z.string().optional() }),
  z.strictObject({ kind: z.literal("panel"), runId: RunIdSchema, captures: RunCaptureAvailabilityWireSchema }),
]);
const messageRefusals = [TargetNotFoundError, SectionUnavailableError, LogIdentityRefusedError,
  ProjectionDegradedError, DiagnosticBundleBytesMissingError, DiagnosticBundleCorruptError] as const;
const catalogRefusals = [LogDisplayRefusedError, OcrReviewRefusedError, ProtectedSubjectDisplayRefusedError] as const;
const WorkbookErrorCodeSchema = z.enum(ErrorCatalogCodeSchema.options.filter(
  (code): code is Extract<ErrorCatalogCode, `WORKBOOK_${string}`> => code.startsWith("WORKBOOK_"),
));
const LaneReplySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("served"), body: z.string() }),
  z.strictObject({ state: z.literal("receipt-missing") }),
  z.strictObject({ state: z.literal("workbook-refused"), code: WorkbookErrorCodeSchema }),
  z.strictObject({ state: z.literal("refused"), name: z.string(), message: z.string() }),
  z.strictObject({ state: z.literal("invalid"), issues: z.array(z.strictObject({
    path: z.array(z.union([z.string(), z.number()])), message: z.string(),
  })) }),
]);
type LaneReply = z.infer<typeof LaneReplySchema>;

export class MissingLaneReceipt extends Error {}

function laneReply(build: () => object): LaneReply {
  try {
    return { state: "served", body: JSON.stringify(build()) };
  } catch (error: unknown) {
    if (error instanceof MissingLaneReceipt) return { state: "receipt-missing" };
    if (error instanceof WorkbookLibraryError) return { state: "workbook-refused", code: error.code };
    if (error instanceof z.ZodError) return { state: "invalid", issues: error.issues.map(({ path, message }) =>
      ({ path: path.map(key => typeof key === "symbol" ? String(key) : key), message })) };
    if (error instanceof Error && [...messageRefusals, ...catalogRefusals].some(Refusal => error instanceof Refusal)) {
      return { state: "refused", name: error.name, message: error.message };
    }
    throw error;
  }
}

function throwLaneRefusal(name: string, message: string): never {
  const CatalogRefusal = catalogRefusals.find(candidate => candidate.name === name);
  if (CatalogRefusal !== undefined) throw new CatalogRefusal();
  const Refusal = messageRefusals.find(candidate => candidate.name === name);
  if (Refusal === undefined) throw new Error(`run-read-lane-unknown-refusal: ${name}`);
  throw new Refusal(message);
}

interface RunDetailLaneResources {
  readonly deps: RunDetailQueryDeps;
  update(facts: ProcessFacts, through: number): void;
}

export function defineRunDetailLaneRead(module: string, compose: (context: LaneReadContext, facts: ProcessFacts) => RunDetailLaneResources) {
  const laneResources = new WeakMap<AuthorityDatabase, RunDetailLaneResources & { noteScanCache: RunNoteScanCache }>();
  return defineLaneRead(module, "run-detail", {
    lane: "navigation", priority: "interactive", timeline: true, processFacts: true, args: RunReadRequestSchema,
    run(context, request) {
      return laneReply(() => {
        const facts = ProcessFactsSchema.parse(context.processFacts);
        let resources = laneResources.get(context.history);
        if (resources === undefined) {
          resources = { ...compose(context, facts), noteScanCache: createRunNoteScanCache() };
          laneResources.set(context.history, resources);
        }
        const { deps, noteScanCache } = resources;
        resources.update(facts, context.history.authority.timelineEvents.highWaterMark());
        if (request.kind === "section") {
          return buildRunSection(deps, request.runId, request.section, request.cursor, noteScanCache);
        }
        const detail = buildRunDetail(deps, request.runId, request.captures);
        if (request.kind === "detail") return detail;
        const logs = readWholePanelLogs(deps, request.runId, detail);
        const sections = PANEL_SECTIONS.filter(name => name !== "captures" && detail.availableSections.includes(name))
          .map(name => buildRunSection(deps, request.runId, name));
        return { detail, logs, sections };
      });
    },
  });
}

type RunLaneDefinition = LaneReadDefinition<z.output<typeof RunReadRequestSchema>, LaneReply>;
const runReadBindings = new WeakMap<RunDetailQueryDeps, { lanes: DashboardReadLanes; definition: RunLaneDefinition; revision: number; facts?: string }>();

export function bindRunDetailReadLane(deps: RunDetailQueryDeps, lanes: DashboardReadLanes, definition: RunLaneDefinition): void {
  runReadBindings.set(deps, { lanes, definition, revision: 0 });
}

const readOptions = (slot: string, signal?: AbortSignal, tab?: string) => ({
  ...(signal === undefined ? {} : { signal }),
  ...(tab === undefined ? {} : { slot: { subscriberId: tab, slot } }),
});

async function requestRunRead(
  deps: RunDetailQueryDeps, request: z.input<typeof RunReadRequestSchema>, signal?: AbortSignal, tab?: string,
): Promise<string | undefined> {
  const binding = runReadBindings.get(deps);
  if (binding === undefined) return undefined;
  signal?.throwIfAborted();
  const withWorkers = request.kind === "panel" || (request.kind === "section" && request.section === "parked-write");
  if (deps.operatorName === undefined) throw new Error("run-read-lane-operator-name-missing");
  const facts = { operatorName: deps.operatorName(), workers: withWorkers ? deps.workerMembers?.() ?? [] : [] };
  const key = JSON.stringify(facts);
  if (key !== binding.facts) {
    binding.facts = key;
    binding.revision++;
  }
  const slot = request.kind === "section" ? `run-section:${request.section}` : "run-detail";
  const response = await binding.lanes.read(binding.definition, RunReadRequestSchema.parse(request), {
    ...readOptions(slot, signal, tab), processFacts: { revision: binding.revision, facts },
  });
  const reply = LaneReplySchema.parse(JSON.parse(response.body));
  switch (reply.state) {
    case "served": return reply.body;
    case "receipt-missing": {
      if (request.kind !== "section" || request.section !== "receipt") throw new Error("run-read-lane-unexpected-receipt-refusal");
      return undefined;
    }
    case "workbook-refused": throw new WorkbookLibraryError(reply.code);
    case "refused": return throwLaneRefusal(reply.name, reply.message);
    case "invalid": throw new z.ZodError(reply.issues.map(issue => ({ ...issue, code: "custom" })));
  }
}

export async function readRunDetailBody(deps: RunDetailQueryDeps, runId: string, signal?: AbortSignal, tab?: string): Promise<string> {
  const captures = await readRunCaptureAvailability(deps, runId, signal);
  return await requestRunRead(deps, { kind: "detail", runId, captures }, signal, tab)
    ?? JSON.stringify(buildRunDetail(deps, runId, captures));
}

export async function readRunSectionBody(deps: RunDetailQueryDeps, runId: string, sectionInput: string,
  cursor?: string, signal?: AbortSignal, tab?: string): Promise<string> {
  RunIdSchema.parse(runId);
  const section = SectionNameSchema.parse(sectionInput);
  const body = section === "captures" ? undefined : await requestRunRead(deps, {
    kind: "section", runId, section, ...(cursor === undefined ? {} : { cursor }),
  }, signal, tab);
  return body ?? JSON.stringify(await readRunSection(deps, runId, section, cursor, signal));
}

export function readRunAttemptHistoryBody(deps: RunDetailQueryDeps, runId: string, request: ItemAttemptHistoryRequest,
  signal?: AbortSignal, tab?: string): string | Promise<string> {
  const lanes = runReadBindings.get(deps)?.lanes;
  if (lanes !== undefined) return readItemAttemptHistoryBody(lanes, runId, request, readOptions("run-attempt-history", signal, tab));
  if (deps.itemAttemptHistory === undefined) throw new SectionUnavailableError("same-item attempt history is not composed");
  return JSON.stringify(deps.itemAttemptHistory.read(runId, request));
}

function readWholePanelLogs(deps: RunDetailQueryDeps, runId: string, detail: RunDetailWire) {
  if (!detail.availableSections.includes("logs")) throw new SectionUnavailableError(`section logs is not available for run ${runId}`);
  return buildRunLogsWhole(deps, runId, deps.projection.runFold(runId), requireTrustRun(deps.runReader, runId)).payload;
}

const LanePanelSchema = z.strictObject({
  detail: RunDetailWireSchema, logs: NotePageSchema, sections: z.array(RunDetailSectionResponseSchema),
});

/** Everything the run panel holds, read by the same queries its routes serve. A refusal throws as the route's would. */
export async function readRunPanel(
  deps: RunDetailQueryDeps,
  runId: string,
  signal: AbortSignal,
): Promise<Extract<RunPanel, { state: "available" }>> {
  if (runReadBindings.has(deps)) {
    const captures = await readRunCaptureAvailability(deps, runId, signal);
    signal.throwIfAborted();
    const body = await requestRunRead(deps, { kind: "panel", runId, captures }, signal);
    if (body === undefined) throw new Error("run-read-lane-panel-body-missing");
    const panel = LanePanelSchema.parse(JSON.parse(body));
    const sections = panel.detail.captures?.state === "available"
      ? [await readRunSection(deps, runId, "captures", undefined, signal), ...panel.sections] : panel.sections;
    signal.throwIfAborted();
    return { state: "available", detail: panel.detail, logs: panel.logs, sections };
  }
  const detail = await readRunDetail(deps, runId, signal);
  signal.throwIfAborted();
  const logs = readWholePanelLogs(deps, runId, detail);
  const sections = await Promise.all(PANEL_SECTIONS
    .filter(name => detail.availableSections.includes(name) && (name !== "captures" || detail.captures?.state === "available"))
    .map(name => readRunSection(deps, runId, name, undefined, signal)));
  signal.throwIfAborted();
  return { state: "available", detail, logs, sections };
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
