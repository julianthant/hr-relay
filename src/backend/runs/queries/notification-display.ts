import type { RunExistence } from "../../../models/config/authority.js";
import type { NotificationRecord } from "../../../models/notifications/notifications.js";
import type { NotificationDisplayContext } from "../../../models/dashboard/projection.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { resolveSubjectTitle, type SubjectCheckpointSource } from "../projections/run-subject-title.js";
import { assertRunTimelineCompatible, type RunTimelineEvidenceSource } from "./run-timeline-compatibility.js";
import type { RunDetailDescriptorView } from "./run-detail-types.js";
import { LogIdentityRefusedError } from "../commands/refusals.js";

export function notificationDisplayContext(record: NotificationRecord, deps: {
  read(id: string): RunExistence;
  descriptor(workflowId: string): { label: string; contractFingerprint: string; subjectProjection?: { nodeId: string; fieldPath: string }; timeline?: RunDetailDescriptorView["timeline"] } | undefined;
  checkpoints: { listByAttempt(workflowId: string, itemId: string, nodeId: string, attempt: number): readonly RunCheckpointRecord[] };
  presentation: RunTimelineEvidenceSource;
}): NotificationDisplayContext {
  const link = record.links[0];
  if (link === undefined || link.kind === "storage") return { state: "not-applicable" };
  const current = deps.read(link.runId);
  if (current.state !== "present") return { state: "unavailable" };
  const { workflow, itemId } = current.run.envelope;
  const descriptor = deps.descriptor(workflow);
  if (descriptor === undefined || descriptor.timeline === undefined && descriptor.contractFingerprint !== current.run.envelope.contractFingerprint) return { state: "unavailable" };
  try {
    assertRunTimelineCompatible(current.run, descriptor.timeline, deps.presentation);
  } catch (error) {
    if (error instanceof LogIdentityRefusedError) return { state: "unavailable" };
    throw error;
  }
  const subject = resolveSubjectTitle(descriptor.subjectProjection, { workflowId: workflow, itemId }, {
    latestCheckpoint: (workflowId, item, nodeId) => deps.checkpoints.listByAttempt(workflowId, item, nodeId, current.run.envelope.attempt)
      .filter(row => row.attempt === current.run.envelope.attempt && row.runId === current.run.envelope.runId
        && row.contractFingerprint === current.run.envelope.contractFingerprint
        && (row.claimGeneration === undefined || row.claimGeneration <= current.run.claimGeneration))
      .at(-1),
  } satisfies SubjectCheckpointSource);
  return subject === undefined ? { state: "workflow-only", workflow: descriptor.label } : { state: "available", workflow: descriptor.label, subject };
}
