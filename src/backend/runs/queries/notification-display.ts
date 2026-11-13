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

export function notificationDisplayContext(record: NotificationRecord, deps: {
  read(id: string): RunExistence;
  descriptor(workflowId: string): AnyWorkflowDescriptor | undefined;
  receipt(runId: string): RunEvidenceReceipt | undefined;
  checkpoints: { listByAttempt(workflowId: string, itemId: string, nodeId: string, attempt: number): readonly RunCheckpointRecord[] };
  presentation: RunTimelineEvidenceSource;
  command(id: string): CommandRequest | undefined;
}): NotificationDisplayContext {
  const link = record.links[0];
  if (link === undefined || link.kind === "storage" || link.kind === "bulk-result") return { state: "not-applicable" };
  const runId = link.kind === "recovery" || link.kind === "command-result" ? commandRunId(deps.command(link.commandId)) : link.runId;
  if (runId === undefined) return { state: "unavailable" };
  const current = deps.read(runId);
  if (current.state !== "present") return { state: "unavailable" };
  const { workflow, itemId } = current.run.envelope;
  const descriptor = deps.descriptor(workflow);
  if (descriptor === undefined) return { state: "unavailable" };
  if (descriptor.version !== current.run.envelope.descriptorVersion || descriptor.contractFingerprint !== current.run.envelope.contractFingerprint) {
    if (descriptor.timeline === undefined) return { state: "unavailable" };
    try {
      assertRunTimelineCompatible(current.run, descriptor.timeline, deps.presentation);
    } catch (error) {
      if (error instanceof LogIdentityRefusedError) return { state: "unavailable" };
      throw error;
    }
  }
  if (current.run.displayName !== undefined && retainedRunProtectedBindings(current.run).length === 0) return { state: "available", workflow: descriptor.label, subject: current.run.displayName };
  if (descriptor.titleProjection !== undefined) {
    try {
      const subject = resolveResultTitle(descriptor, current.run, deps.receipt(current.run.envelope.runId));
      return subject === undefined ? { state: 'unavailable' } : { state: 'available', workflow: descriptor.label, subject };
    } catch (error) {
      if (error instanceof ProjectionDegradedError) return { state: 'unavailable' };
      throw error;
    }
  }
  const subject = resolveSubjectTitle(descriptor.subjectProjection, { workflowId: workflow, itemId }, {
    latestCheckpoint: (workflowId, item, nodeId) => deps.checkpoints.listByAttempt(workflowId, item, nodeId, current.run.envelope.attempt)
      .filter(row => row.attempt === current.run.envelope.attempt && row.runId === current.run.envelope.runId
        && row.contractFingerprint === current.run.envelope.contractFingerprint
        && (row.claimGeneration === undefined || row.claimGeneration <= current.run.claimGeneration))
      .at(-1),
  } satisfies SubjectCheckpointSource) ?? queuedTitle(current.run, deps.presentation.timeline);
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
