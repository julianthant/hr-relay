import type { RunDetailQueryDeps } from "../run-detail-types.js";
import type { RunRecord } from "../../../../models/run/record.js";
import type { WriteIntentRecord } from "../../../../rules/write-safety/write-safety.js";
import { UcpathFindingsDetailSchema, type UcpathFindingsDetail } from "../../../../models/dashboard/ucpath-findings.js";
import { UcpathReadTransactionFindings } from "../../../../models/systems/ucpath/read-transaction-findings.js";
import { UcpathTerminationTargetSchema, isUcpathTerminationAction } from "../../../../models/ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionFindingsReadSchema, type UcpathTransactionFindingsRead } from "../../../../models/ui/ucpath-transaction-findings.js";
import { descriptorRuntimeNodes } from "../../../../workflow-kit/workflow.js";
import { deriveSchemaHash } from "../../../../models/validation/schema-bound-value.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../workflow-kit/validation/build-manifest.js";
import { readRunCheckpoint } from "../../../runtime/checkpoints/run-checkpoint-reader.js";
import { rebuildCommitInput, requireWriteResolutionBinding } from "../../../runtime/writes/write-resolution-binding.js";
import { LogIdentityRefusedError } from "../../commands/refusals.js";
import { checkpointLookupKey } from "../../../../models/workflow/checkpoint.js";
import { timelineCheckpointReference } from "../../../../models/events/timeline.js";
import { deriveStableUuid } from "../../../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { firstDisagreeingName } from "../../../systems/ucpath/termination-verdict.js";

export function projectUcpathFindings(scan: UcpathTransactionFindingsRead, targetValue: unknown): UcpathFindingsDetail {
  const parsedTarget = UcpathTerminationTargetSchema.safeParse(targetValue);
  if (!parsedTarget.success) throw new LogIdentityRefusedError("UCPATH_FINDINGS_TARGET_INVALID");
  const target = parsedTarget.data;
  if (scan.emplId !== target.emplId) throw new LogIdentityRefusedError("UCPATH_FINDINGS_SUBJECT_MISMATCH");
  if (scan.rows.some(row => row.emplId !== target.emplId) || firstDisagreeingName(scan, target.expectedName) !== undefined) {
    throw new LogIdentityRefusedError("UCPATH_FINDINGS_SUBJECT_MISMATCH");
  }
  return UcpathFindingsDetailSchema.parse({ state: "found", findings: scan,
    selectorVerification: "pending-live-verification", authoritative: false,
    matches: scan.rows.map(row => ({ transactionId: row.transactionId,
      match: isUcpathTerminationAction(row.action) && row.startDate === target.effectiveDate ? "exact" : "different" })) });
}

export function retainedUcpathFindings(deps: RunDetailQueryDeps, run: RunRecord, intent: WriteIntentRecord): UcpathFindingsDetail {
  const canonical = deps.canonical;
  const descriptor = canonical?.descriptors.resolve(run.envelope.workflow);
  if (intent.taskId !== "ucpath/create-termination" || canonical?.database === undefined || descriptor === undefined
    || descriptor.version !== run.envelope.descriptorVersion || descriptor.contractFingerprint !== run.envelope.contractFingerprint) return { state: "unavailable" };
  const nodes = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "task")
    .filter(node => node.uses.id === UcpathReadTransactionFindings.id);
  const evidence = nodes.flatMap(node => {
    const stored = readRunCheckpoint(canonical.database.authority, run.envelope, node.id, true);
    if (stored === undefined) return [];
    if (stored.workflowId !== run.envelope.workflow || stored.itemId !== run.envelope.itemId || stored.nodeId !== node.id
      || stored.descriptorVersion !== run.envelope.descriptorVersion || stored.contractFingerprint !== run.envelope.contractFingerprint
      || stored.runId !== run.envelope.runId || stored.attempt !== run.envelope.attempt || stored.assertion !== undefined
      || Number(stored.claimGeneration) !== Number(run.claimGeneration)
      || stored.output.schemaHash !== deriveSchemaHash(UcpathReadTransactionFindings.output, "output")
      || deriveSchemaHash(node.uses.output, "output") !== stored.output.schemaHash
      || stored.implFingerprint !== resolveTaskImplFingerprint(BUILD_MANIFEST, UcpathReadTransactionFindings.id)) {
      throw new LogIdentityRefusedError("UCPATH_FINDINGS_EVIDENCE_MISMATCH");
    }
    const eventId = deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(
      stored.workflowId, stored.itemId, stored.nodeId, stored.attempt, stored.claimGeneration,
    ));
    const event = canonical.database.authority.timelineEvents.get(eventId);
    if (event?.payload.kind !== "checkpoint-recorded" || event.payload.runId !== run.envelope.runId
      || event.payload.workflow !== run.envelope.workflow || event.payload.attempt !== run.envelope.attempt
      || Number(event.payload.claimGeneration) !== Number(run.claimGeneration)
      || canonicalJsonStringify(event.payload.checkpoint) !== canonicalJsonStringify(timelineCheckpointReference(stored))) {
      throw new LogIdentityRefusedError("UCPATH_FINDINGS_CONFIRMATION_MISMATCH");
    }
    const parsed = UcpathTransactionFindingsReadSchema.safeParse(stored.output.value);
    if (!parsed.success) throw new LogIdentityRefusedError("UCPATH_FINDINGS_PAYLOAD_INVALID");
    return [parsed.data];
  });
  if (evidence.length === 0) return { state: "unavailable" };
  if (evidence.length !== 1) throw new LogIdentityRefusedError("UCPATH_FINDINGS_EVIDENCE_AMBIGUOUS");
  const { node } = requireWriteResolutionBinding({ arm: "recovery-probe", descriptor, run, intent, repositories: canonical.database.authority });
  return projectUcpathFindings(evidence[0], rebuildCommitInput(canonical.database.authority, descriptor, node, run, intent));
}
