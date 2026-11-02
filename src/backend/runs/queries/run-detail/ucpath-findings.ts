import type { RunDetailQueryDeps } from "../run-detail-types.js";
import type { RunRecord } from "../../../../models/run/record.js";
import type { WorkerControlRecord } from "../../../../models/run/worker-control.js";
import type { WriteIntentRecord } from "../../../../rules/write-safety/write-safety.js";
import { UcpathFindingsDetailSchema, type UcpathFindingsDetail } from "../../../../models/dashboard/ucpath-findings.js";
import { UcpathReadTransactionFindings } from "../../../../models/systems/ucpath/read-transaction-findings.js";
import { UcpathTerminationTargetSchema, isUcpathTerminationAction } from "../../../../models/ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionFindingsReadSchema, type UcpathTransactionFindingsRead } from "../../../../models/ui/ucpath-transaction-findings.js";
import { deriveSchemaHash } from "../../../../models/validation/schema-bound-value.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../workflow-kit/validation/build-manifest.js";
import { rebuildCommitInput, requireWriteResolutionBinding } from "../../../runtime/writes/write-resolution-binding.js";
import { LogIdentityRefusedError } from "../../commands/refusals.js";
import { deriveStableUuid } from "../../../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { firstDisagreeingName } from "../../../systems/ucpath/termination-verdict.js";

export function projectUcpathFindings(scan: UcpathTransactionFindingsRead, targetValue: unknown): UcpathFindingsDetail {
  const parsedTarget = UcpathTerminationTargetSchema.safeParse(targetValue);
  if (!parsedTarget.success) throw new LogIdentityRefusedError("UCPATH_FINDINGS_TARGET_INVALID");
  const target = parsedTarget.data;
  if (scan.emplId !== target.emplId || scan.rows.some(row => row.emplId !== target.emplId)
    || firstDisagreeingName(scan, target.expectedName) !== undefined) throw new LogIdentityRefusedError("UCPATH_FINDINGS_SUBJECT_MISMATCH");
  return UcpathFindingsDetailSchema.parse({ state: "found", findings: scan,
    selectorVerification: "pending-live-verification", authoritative: false,
    matches: scan.rows.map(row => ({ transactionId: row.transactionId,
      match: isUcpathTerminationAction(row.action) && row.startDate === target.effectiveDate ? "exact" : "different" })) });
}

export function retainedUcpathFindings(deps: RunDetailQueryDeps, run: RunRecord, intent: WriteIntentRecord,
  retained: WorkerControlRecord | undefined): UcpathFindingsDetail {
  const canonical = deps.canonical;
  const descriptor = canonical?.descriptors.resolve(run.envelope.workflow);
  if (intent.taskId !== "ucpath/create-termination" || canonical?.database === undefined || descriptor === undefined
    || descriptor.version !== run.envelope.descriptorVersion || descriptor.contractFingerprint !== run.envelope.contractFingerprint
    || retained?.phase.state !== "succeeded" || retained.phase.acknowledgement.kind !== "parked-write-check"
    || retained.phase.acknowledgement.findingsIdentity === undefined) return { state: "unavailable" };
  const ack = retained.phase.acknowledgement;
  const identity = ack.findingsIdentity;
  if (identity === undefined) return { state: "unavailable" };
  const { result, evidence } = ack;
  const target = result.target;
  if (retained.request.type !== "check-parked-write" || retained.commandId !== result.commandId
    || retained.request.requestedBy !== "local-operator" || retained.request.source !== "run-detail"
    || result.requestedBy !== retained.request.requestedBy || canonicalJsonStringify(retained.request.target) !== canonicalJsonStringify(target)
    || target.installationId !== deps.authorityIdentity?.installationId || target.profileId !== deps.authorityIdentity?.profileId
    || target.runId !== run.envelope.runId || target.runVersion !== run.version || target.runAttempt !== run.envelope.attempt
    || target.workflowId !== run.envelope.workflow || target.itemId !== run.envelope.itemId || target.traceId !== run.envelope.traceId
    || intent.status !== "parked" || target.writeIntentId !== intent.writeIntentId || target.intentVersion !== intent.version
    || target.intentGeneration !== intent.generation || target.writeAttemptId !== intent.currentAttemptId
    || target.bindingProofDigest !== intent.bindingProofDigest || target.occurrenceKeyDigest !== intent.idempotencyKeyDigest
    || intent.bindingProof.afterPrepareSpanPath !== `${target.traceId}/${target.nodeId}/prepare`
    || identity.descriptorVersion !== descriptor.version || identity.contractFingerprint !== descriptor.contractFingerprint
    || Number(identity.claimGeneration) !== Number(run.claimGeneration) || identity.implFingerprint !== resolveTaskImplFingerprint(BUILD_MANIFEST, UcpathReadTransactionFindings.id)
    || result.probeTaskId !== UcpathReadTransactionFindings.id || result.provenance !== "system-probe" || result.state !== "unknown"
    || evidence?.schemaHash !== deriveSchemaHash(UcpathReadTransactionFindings.output, "output")
    || result.evidenceDigest !== sha256Hex(canonicalJsonStringify({ target, state: result.state, code: result.code, evidence, findingsIdentity: identity }))) {
    throw new LogIdentityRefusedError("UCPATH_FINDINGS_EVIDENCE_MISMATCH");
  }
  const start = canonical.database.authority.timelineEvents.get(identity.activityId);
  const end = canonical.database.authority.timelineEvents.get(deriveStableUuid("recovery-activity-ended", identity.activityId));
  if (start?.payload.kind !== "recovery-activity-started" || end?.payload.kind !== "recovery-activity-ended") {
    throw new LogIdentityRefusedError("UCPATH_FINDINGS_ACTIVITY_UNCONFIRMED");
  }
  const { kind: _endKind, endedAt: _endedAt, ...ended } = end.payload;
  const { kind: _startKind, ...opened } = start.payload;
  if (canonicalJsonStringify(ended) !== canonicalJsonStringify(opened) || opened.activityId !== identity.activityId || opened.operation !== "parked-write-check"
    || Date.parse(end.payload.endedAt) < Date.parse(opened.openedAt) || Date.parse(end.payload.endedAt) > Date.parse(result.observedAt)
    || opened.runId !== target.runId || opened.workflow !== target.workflowId || opened.attempt !== target.runAttempt
    || opened.traceId !== target.traceId || opened.nodeId !== target.nodeId || opened.writeIntentId !== target.writeIntentId
    || opened.generation !== target.intentGeneration || opened.writeAttemptId !== target.writeAttemptId) {
    throw new LogIdentityRefusedError("UCPATH_FINDINGS_ACTIVITY_MISMATCH");
  }
  const parsed = UcpathTransactionFindingsReadSchema.safeParse(evidence.value);
  if (!parsed.success) throw new LogIdentityRefusedError("UCPATH_FINDINGS_PAYLOAD_INVALID");
  const { node } = requireWriteResolutionBinding({ arm: "recovery-probe", descriptor, run, intent, repositories: canonical.database.authority });
  if (node.id !== target.nodeId) throw new LogIdentityRefusedError("UCPATH_FINDINGS_NODE_MISMATCH");
  return projectUcpathFindings(parsed.data, rebuildCommitInput(canonical.database.authority, descriptor, node, run, intent));
}
