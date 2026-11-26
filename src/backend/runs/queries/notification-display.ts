import type { RunExistence } from "../../../models/config/authority.js";
import type { NotificationRecord } from "../../../models/notifications/notifications.js";
import type { NotificationDisplayContext } from "../../../models/dashboard/projection.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { resolveResultTitle, resolveSubjectTitle, type SubjectCheckpointSource } from "../projections/run-subject-title.js";
import { assertRunTimelineCompatible, type RunTimelineEvidenceSource } from "./run-timeline-compatibility.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { TimelineRepository } from "../../../models/events/timeline.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { readTimelineRecords } from "../../storage/events/timeline-reader.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import { LogIdentityRefusedError, ProjectionDegradedError } from "../commands/refusals.js";

type DisplayDependencies = {
  read(id: string): RunExistence;
  descriptor(workflowId: string): AnyWorkflowDescriptor | undefined;
  receipt(runId: string): RunEvidenceReceipt | undefined;
  checkpoints: { listByAttempt(workflowId: string, itemId: string, nodeId: string, attempt: number): readonly RunCheckpointRecord[] };
  presentation: RunTimelineEvidenceSource;
  command(id: string): CommandRequest | undefined;
};

export function createNotificationDisplayContext(deps: DisplayDependencies) {
  const held = new Map<string, { actor: string; notificationVersion: number; runId: string; runVersion: number; evidence: number; context: NotificationDisplayContext }>();
  return (record: NotificationRecord, revision: (id: string) => number | undefined, read: DisplayDependencies["read"],
    command: DisplayDependencies["command"] = deps.command): NotificationDisplayContext =>
    notificationDisplayContext(record, { ...deps, read, command }, run => {
      const prior = held.get(record.notificationId);
      const { version: runVersion, envelope: { runId } } = run;
      const evidence = revision(runId);
      if (prior?.actor === record.actorId && prior.notificationVersion === record.version && prior.runId === runId
        && prior.runVersion === runVersion && prior.evidence === evidence) return prior.context;
      const context = runDisplayContext(run, deps);
      if (evidence !== undefined) {
        if (held.size >= 1024 && prior === undefined) {
          const oldest = held.keys().next().value;
          if (oldest !== undefined) held.delete(oldest);
        }
        held.set(record.notificationId, { actor: record.actorId, notificationVersion: record.version, runId, runVersion, evidence, context });
      }
      return context;
    });
}

export function notificationDisplayContext(record: NotificationRecord, deps: DisplayDependencies,
  projectRun: (run: RunRecord) => NotificationDisplayContext = run => runDisplayContext(run, deps)): NotificationDisplayContext {
  const link = record.links[0];
  if (link === undefined || link.kind === "storage" || link.kind === "bulk-result") return { state: "not-applicable" };
  const runId = notificationDisplayRunId(record, deps.command);
  if (runId === undefined) return { state: "unavailable" };
  const current = deps.read(runId);
  return current.state === "present" ? projectRun(current.run) : { state: "unavailable" };
}

export function notificationDisplayRunId(record: NotificationRecord, command: DisplayDependencies["command"]): string | undefined {
  const link = record.links[0];
  if (link === undefined || link.kind === "storage" || link.kind === "bulk-result") return undefined;
  return link.kind === "recovery" || link.kind === "command-result" ? commandRunId(command(link.commandId)) : link.runId;
}

function runDisplayContext(run: RunRecord, deps: DisplayDependencies): NotificationDisplayContext {
  const { workflow, itemId } = run.envelope;
  const descriptor = deps.descriptor(workflow);
  if (descriptor === undefined) return { state: "unavailable" };
  const workflowOnly = { state: "workflow-only", workflow: descriptor.label } as const;
  if (descriptor.version !== run.envelope.descriptorVersion || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
    if (descriptor.timeline === undefined) return workflowOnly;
    try {
      assertRunTimelineCompatible(run, descriptor.timeline, deps.presentation);
    } catch (error) {
      if (error instanceof LogIdentityRefusedError) return workflowOnly;
      throw error;
    }
  }
  if (run.displayName !== undefined && retainedRunProtectedBindings(run).length === 0) return { state: "available", workflow: descriptor.label, subject: run.displayName };
  if (descriptor.titleProjection !== undefined) {
    try {
      const subject = resolveResultTitle(descriptor, run, deps.receipt(run.envelope.runId));
      return subject === undefined ? workflowOnly : { state: "available", workflow: descriptor.label, subject };
    } catch (error) {
      if (error instanceof ProjectionDegradedError) return workflowOnly;
      throw error;
    }
  }
  const subject = resolveSubjectTitle(descriptor.subjectProjection, { workflowId: workflow, itemId }, {
    latestCheckpoint: (workflowId, item, nodeId) => deps.checkpoints.listByAttempt(workflowId, item, nodeId, run.envelope.attempt)
      .filter(row => row.attempt === run.envelope.attempt && row.runId === run.envelope.runId
        && row.contractFingerprint === run.envelope.contractFingerprint
        && (row.claimGeneration === undefined || row.claimGeneration <= run.claimGeneration))
      .at(-1),
  } satisfies SubjectCheckpointSource) ?? queuedTitle(run, deps.presentation.timeline);
  return subject === undefined ? { state: "workflow-only", workflow: descriptor.label } : { state: "available", workflow: descriptor.label, subject };
}

/** The exact title the run was queued under, as the queue shows it; a pruned timeline no longer holds it. */
function queuedTitle(run: RunRecord, timeline: TimelineRepository): string | undefined {
  const { runId, workflow, itemId, attempt } = run.envelope;
  const queued = readTimelineRecords(timeline, 0, runId).records.flatMap(record =>
    record.payload.kind === "span" && record.payload.event.t === "run.queued" && record.payload.event.runId === runId ? [record.payload.event] : []);
  if (queued.length > 1) throw new Error(`notification-display: run ${runId} has ${String(queued.length)} run.queued events`);
  const event = queued[0];
  if (event === undefined) return undefined;
  if (event.workflow !== workflow || event.itemId !== itemId || event.attempt !== attempt) {
    throw new Error(`notification-display: run.queued for run ${runId} names another workflow, item or attempt`);
  }
  return event.title;
}

function commandRunId(request: CommandRequest | undefined): string | undefined {
  if (request === undefined || !("target" in request) || !("runId" in request.target)) return undefined;
  return request.target.runId;
}
