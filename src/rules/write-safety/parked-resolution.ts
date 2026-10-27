import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "./write-safety.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../identity/ids.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";

export function authenticateParkedWriteResolution(intentInput: unknown, attemptInput: unknown, commandInput: unknown, auditInput: unknown) {
  const intent = WriteIntentRecordSchema.parse(intentInput);
  const attempt = WriteAttemptRecordSchema.parse(attemptInput);
  const command = CommandRequestSchema.parse(commandInput);
  const audit = CommandAuditRecordSchema.parse(auditInput);
  if ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined
    || attempt.outcome.state !== "parked" || command.family !== "run"
    || (command.type !== "resolve-write-present" && command.type !== "resolve-write-absent")) throw new Error("parked-write-resolution-authentication-missing");
  if (canonicalJsonStringify(audit.writeResolution) !== canonicalJsonStringify(intent)) throw new Error("parked-write-resolution-audit-acknowledgement-mismatch");
  const binding = intent.resolution;
  if (binding.commandId !== command.commandId || binding.auditId !== audit.auditId
    || command.requestedBy !== LOCAL_OPERATOR_ACTOR_ID || audit.completedAt !== binding.resolvedAt
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || command.target.runId !== binding.runId || command.target.expectedVersion !== binding.expectedRunVersion
    || command.target.writeIntentId !== binding.writeIntentId || command.target.intentGeneration !== binding.generation
    || command.target.writeAttemptId !== binding.writeAttemptId || command.target.bindingProofDigest !== binding.bindingProofDigest
    || command.payload.occurrenceKeyDigest !== binding.idempotencyKeyDigest
    || attempt.writeAttemptId !== binding.writeAttemptId || attempt.writeIntentId !== binding.writeIntentId
    || attempt.generation !== binding.generation || attempt.bindingProofDigest !== binding.bindingProofDigest
    || attempt.runId !== binding.runId || attempt.runAttempt !== binding.runAttempt
    || attempt.fencedAt !== intent.fencedAt || canonicalJsonStringify(attempt.bindingProof) !== canonicalJsonStringify(intent.bindingProof)
    || intent.updatedAt !== binding.resolvedAt) throw new Error("parked-write-resolution-binding-mismatch");
  if (audit.result.state !== "applied" || audit.result.commandId !== binding.commandId
    || audit.result.affectedTargets.length !== 1 || audit.result.affectedTargets[0]?.family !== "run"
    || audit.result.affectedTargets[0].runId !== binding.runId || audit.versionChanges.length !== 1
    || audit.versionChanges[0]?.target.family !== "run" || audit.versionChanges[0].target.runId !== binding.runId
    || Number(audit.versionChanges[0].before) !== binding.expectedRunVersion
    || Number(audit.versionChanges[0].after) !== binding.expectedRunVersion + 1) throw new Error("parked-write-resolution-audit-result-mismatch");
  if (intent.status === "committed") {
    if (command.type !== "resolve-write-present" || binding.decision !== "present"
      || canonicalJsonStringify(command.payload.proof) !== canonicalJsonStringify(intent.completionProof)
      || intent.confirmedAt !== binding.resolvedAt) throw new Error("parked-write-resolution-positive-proof-mismatch");
  } else if (command.type !== "resolve-write-absent" || binding.decision !== "absent"
    || intent.settlement.state !== "operator-confirmed-absent" || intent.resolvedAt !== binding.resolvedAt
    || intent.settlement.operator !== command.requestedBy || intent.settlement.confirmedAt !== binding.resolvedAt) throw new Error("parked-write-resolution-absence-proof-mismatch");
  return {intent,attempt,command,audit};
}

export function authenticateAuditedParkedWriteResolution(attempt: unknown, command: unknown, auditInput: unknown) {
  const audit = CommandAuditRecordSchema.parse(auditInput);
  return authenticateParkedWriteResolution(audit.writeResolution, attempt, command, audit);
}
