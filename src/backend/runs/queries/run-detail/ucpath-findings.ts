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

export function projectUcpathFindings(scan: UcpathTransactionFindingsRead, targetValue: unknown): UcpathFindingsDetail {
  const target = UcpathTerminationTargetSchema.parse(targetValue);
  if (scan.emplId !== target.emplId) throw new Error("UCPATH_FINDINGS_SUBJECT_MISMATCH");
  const name = (value: string) => value.trim().toLowerCase().replaceAll(/\s+/gu, " ");
  if (scan.rows.some(row => name(row.displayedName) !== name(target.expectedName))) throw new Error("UCPATH_FINDINGS_SUBJECT_MISMATCH");
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
  const nodes = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "task" && node.uses.id === UcpathReadTransactionFindings.id);
  const evidence = nodes.flatMap(node => {
    const stored = readRunCheckpoint(canonical.database.authority, run.envelope, node.id, true);
    if (stored === undefined) return [];
    if (stored.runId !== run.envelope.runId || stored.attempt !== run.envelope.attempt
      || Number(stored.claimGeneration) !== Number(run.claimGeneration)
      || stored.output.schemaHash !== deriveSchemaHash(UcpathReadTransactionFindings.output, "output")
      || stored.implFingerprint !== resolveTaskImplFingerprint(BUILD_MANIFEST, UcpathReadTransactionFindings.id)) {
      throw new Error("UCPATH_FINDINGS_EVIDENCE_MISMATCH");
    }
    return [UcpathTransactionFindingsReadSchema.parse(stored.output.value)];
  });
  if (evidence.length === 0) return { state: "unavailable" };
  if (evidence.length !== 1) throw new Error("UCPATH_FINDINGS_EVIDENCE_AMBIGUOUS");
  const { node } = requireWriteResolutionBinding({ arm: "recovery-probe", descriptor, run, intent, repositories: canonical.database.authority });
  return projectUcpathFindings(evidence[0], rebuildCommitInput(canonical.database.authority, descriptor, node, run, intent));
}
