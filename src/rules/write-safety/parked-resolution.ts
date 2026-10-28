import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "./write-safety.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../identity/ids.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";

export function authenticateParkedWriteRecheck(intentInput: unknown, attemptInput: unknown, commandInput: unknown, auditInput: unknown) {
  const intent = WriteIntentRecordSchema.parse(intentInput);
  const attempt = WriteAttemptRecordSchema.parse(attemptInput);
  const command = CommandRequestSchema.parse(commandInput);
  const audit = CommandAuditRecordSchema.parse(auditInput);
  if (intent.status !== "parked" || intent.recheck === undefined || command.family !== "run" || command.type !== "recheck-write"
    || attempt.outcome.state !== "parked") throw new Error("parked-write-recheck-authentication-missing");
  const request = intent.recheck;
  if (canonicalJsonStringify(audit.writeResolution) !== canonicalJsonStringify(intent)
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || command.requestedBy !== LOCAL_OPERATOR_ACTOR_ID || request.commandId !== command.commandId || request.auditId !== audit.auditId
    || request.requestedAt !== audit.completedAt || intent.updatedAt !== request.requestedAt
    || request.expectedRunVersion !== command.target.expectedVersion || request.transactionId !== command.payload.transactionId
    || command.target.runId !== intent.runId || command.target.writeIntentId !== intent.writeIntentId
    || command.target.intentGeneration !== intent.generation || command.target.writeAttemptId !== intent.currentAttemptId
    || command.target.bindingProofDigest !== intent.bindingProofDigest || command.payload.occurrenceKeyDigest !== intent.idempotencyKeyDigest
    || attempt.writeAttemptId !== intent.currentAttemptId || attempt.writeIntentId !== intent.writeIntentId
    || attempt.generation !== intent.generation || attempt.runId !== intent.runId || attempt.runAttempt !== intent.runAttempt
    || attempt.bindingProofDigest !== intent.bindingProofDigest || attempt.fencedAt !== intent.fencedAt
    || canonicalJsonStringify(attempt.bindingProof) !== canonicalJsonStringify(intent.bindingProof)) throw new Error("parked-write-recheck-binding-mismatch");
  authenticateResult(audit, intent.runId, command.commandId, request.expectedRunVersion);
  return { intent, attempt, command, audit };
}

function authenticateResult(audit: ReturnType<typeof CommandAuditRecordSchema.parse>, runId: string, commandId: string, version: number) {
  if (audit.result.state !== "applied" || audit.result.commandId !== commandId
    || audit.result.affectedTargets.length !== 1 || audit.result.affectedTargets[0]?.family !== "run"
    || audit.result.affectedTargets[0].runId !== runId || audit.versionChanges.length !== 1
    || audit.versionChanges[0]?.target.family !== "run" || audit.versionChanges[0].target.runId !== runId
    || Number(audit.versionChanges[0].before) !== version || Number(audit.versionChanges[0].after) !== version + 1) {
    throw new Error("parked-write-resolution-audit-result-mismatch");
  }
}

export function authenticateParkedWriteResolution(intentInput: unknown, attemptInput: unknown, commandInput: unknown, auditInput: unknown) {
  const intent = WriteIntentRecordSchema.parse(intentInput);
  const attempt = WriteAttemptRecordSchema.parse(attemptInput);
  const command = CommandRequestSchema.parse(commandInput);
  const audit = CommandAuditRecordSchema.parse(auditInput);
  if ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined
    || attempt.outcome.state !== "parked" || command.family !== "run"
    || (command.type !== "recheck-write" && command.type !== "resolve-write-absent")) throw new Error("parked-write-resolution-authentication-missing");
  const binding = intent.resolution;
  if (command.type === "recheck-write") {
    const requested = authenticateParkedWriteRecheck(audit.writeResolution, attempt, command, audit).intent;
    if (requested.recheck === undefined) throw new Error("parked-write-recheck-authentication-missing");
    if (intent.status !== "committed" || binding.decision !== "present" || binding.commandId !== requested.recheck.commandId
      || binding.auditId !== requested.recheck.auditId || binding.expectedRunVersion !== requested.recheck.expectedRunVersion
      || Date.parse(binding.resolvedAt) < Date.parse(requested.recheck.requestedAt)) throw new Error("parked-write-recheck-settlement-mismatch");
    const { parkedCode: _code, message: _message, authorityReason: _reason, recheck: _recheck, ...base } = requested;
    const expected = { ...base, status: "committed", version: requested.version + 1, updatedAt: binding.resolvedAt,
      completionProof: intent.completionProof, confirmedAt: binding.resolvedAt, resolution: binding };
    if (canonicalJsonStringify(intent) !== canonicalJsonStringify(expected)) throw new Error("parked-write-recheck-settlement-mismatch");
  } else {
    if (canonicalJsonStringify(audit.writeResolution) !== canonicalJsonStringify(intent)) throw new Error("parked-write-resolution-audit-acknowledgement-mismatch");
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
    authenticateResult(audit, binding.runId, binding.commandId, binding.expectedRunVersion);
    if (intent.status !== "retryable" || binding.decision !== "absent" || intent.settlement.state !== "operator-confirmed-absent"
      || intent.resolvedAt !== binding.resolvedAt || intent.settlement.operator !== command.requestedBy
      || intent.settlement.confirmedAt !== binding.resolvedAt) throw new Error("parked-write-resolution-absence-proof-mismatch");
  }
  return { intent, attempt, command, audit };
}

export function authenticateAuditedParkedWriteResolution(attempt: unknown, command: unknown, auditInput: unknown) {
  const audit = CommandAuditRecordSchema.parse(auditInput);
  if (audit.writeResolution?.status === "parked") return authenticateParkedWriteRecheck(audit.writeResolution, attempt, command, audit);
  return authenticateParkedWriteResolution(audit.writeResolution, attempt, command, audit);
}
