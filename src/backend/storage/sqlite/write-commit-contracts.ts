import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import {
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  WriteIntentIdSchema,
} from "../../../rules/identity/ids.js";
import { LedgerEntryPayloadSchema, WriteCommittedSpanOutboxPayloadSchema } from "../../../rules/runs/ledger.js";
import { RunCheckpointRecordSchema } from "../../../models/workflow/checkpoint.js";
import { SchemaBoundCanonicalValueSchema } from "../../../models/validation/schema-bound-value.js";
import {
  TransactionOutcomeSchema,
  WriteAuthorityReasonSchema,
  WriteRetrySettlementSchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
  ParkedWriteResolutionBindingSchema,
  ParkedWriteRecheckSchema,
} from "../../../rules/write-safety/write-safety.js";
import { RunClaimTokenSchema } from "./run-store-contracts.js";
import { RunRecordRefusalSchema } from "../../../models/config/authority.js";

export const WriteFenceRecordsSchema = z.strictObject({
  intent: WriteIntentRecordSchema,
  attempt: WriteAttemptRecordSchema,
}).superRefine(({ intent, attempt }, context) => {
  if (intent.status !== "attempting") {
    context.addIssue({ code: "custom", path: ["intent", "status"], message: "a write fence must begin with an attempting intent" });
    return;
  }
  if (attempt.outcome.state !== "attempting") {
    context.addIssue({ code: "custom", path: ["attempt", "outcome"], message: "a write fence must begin with an attempting attempt" });
  }
  for (const [field, left, right] of [
    ["writeAttemptId", intent.currentAttemptId, attempt.writeAttemptId],
    ["writeIntentId", intent.writeIntentId, attempt.writeIntentId],
    ["generation", intent.generation, attempt.generation],
    ["runId", intent.runId, attempt.runId],
    ["runAttempt", intent.runAttempt, attempt.runAttempt],
    ["bindingProofDigest", intent.bindingProofDigest, attempt.bindingProofDigest],
    ["fencedAt", intent.fencedAt, attempt.fencedAt],
  ] as const) {
    if (left !== right) context.addIssue({ code: "custom", path: ["attempt", field], message: `${field} must match the fenced intent` });
  }
  if (canonicalJsonStringify(intent.bindingProof) !== canonicalJsonStringify(attempt.bindingProof)) {
    context.addIssue({ code: "custom", path: ["attempt", "bindingProof"], message: "attempt binding proof must exactly match the fenced intent" });
  }
  if (intent.bindingProof.runId !== intent.runId
    || intent.bindingProof.attempt !== intent.runAttempt
    || intent.bindingProof.taskId !== intent.taskId
    || intent.bindingProof.leaseId !== attempt.leaseId) {
    context.addIssue({ code: "custom", path: ["intent", "bindingProof"], message: "binding proof must match the fenced run, attempt, task, and lease" });
  }
});

export const WriteFenceInputSchema = WriteFenceRecordsSchema.safeExtend({ claim: RunClaimTokenSchema });

export const PermanentWriteResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("refused"), refusal: RunRecordRefusalSchema }),
  z.strictObject({
    state: z.literal("fenced"),
    intent: WriteIntentRecordSchema,
    attempt: WriteAttemptRecordSchema,
  }),
  z.strictObject({
    state: z.literal("recorded-observed-present"),
    intent: WriteIntentRecordSchema,
  }),
  z.strictObject({
    state: z.literal("existing"),
    intent: WriteIntentRecordSchema,
  }),
]).superRefine((resolution, context) => {
  if (resolution.state === "fenced") {
    const fence = WriteFenceRecordsSchema.safeParse({ intent: resolution.intent, attempt: resolution.attempt });
    if (!fence.success) {
      context.addIssue({ code: "custom", message: "fenced resolution must contain one semantically consistent intent and attempt" });
    }
  }
  if (resolution.state === "recorded-observed-present" && resolution.intent.status !== "observed-present") {
    context.addIssue({ code: "custom", path: ["intent", "status"], message: "observed-present resolution requires an observed-present intent" });
  }
});

export const AtomicWriteCommitStorageStepSchema = z.enum([
  "intent-state", "attempt-state", "transaction-checkpoint", "timeline-event",
]);
export const AtomicWriteCommitInputSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema, generation: PositiveIntSchema,
  completionProof: SchemaBoundCanonicalValueSchema, confirmedAt: z.iso.datetime({ offset: true }),
  outcome: TransactionOutcomeSchema,
  transaction: LedgerEntryPayloadSchema,
  committedSpan: WriteCommittedSpanOutboxPayloadSchema,
}).superRefine((input, context) => {
  if (input.outcome.disposition !== "committed"
    || canonicalJsonStringify(input.completionProof) !== canonicalJsonStringify(input.transaction.proof)
    || canonicalJsonStringify(input.completionProof) !== canonicalJsonStringify(input.outcome.proof)
    || input.confirmedAt !== input.outcome.confirmedAt
    || input.confirmedAt !== input.transaction.confirmedAt
    || input.confirmedAt !== input.committedSpan.occurredAt
    || input.transaction.proofSource !== input.outcome.proofSource
    || canonicalJsonStringify(input.committedSpan.outcome) !== canonicalJsonStringify(input.outcome)) {
    context.addIssue({ code: "custom", message: "atomic confirmation proof and outcome must agree" });
  }
  for (const facts of [input.transaction, input.committedSpan]) {
    if (facts.writeIntentId !== input.writeIntentId || facts.intentGeneration !== input.generation) {
      context.addIssue({ code: "custom", message: "atomic confirmation operation identity must agree" });
    }
  }
  for (const field of ["runId", "traceId", "workflowId", "itemId", "attempt", "system", "idempotencyKey",
    "idempotencyKeyDigest", "bindingProofDigest"] as const) {
    if (input.transaction[field] !== input.committedSpan[field]) context.addIssue({ code: "custom", message: `atomic confirmation ${field} mismatch` });
  }
});
export const AtomicWriteCommitReportSchema = z.strictObject({
  state: z.literal("committed"), intent: WriteIntentRecordSchema, attempt: WriteAttemptRecordSchema,
  transaction: LedgerEntryPayloadSchema, committedSpan: WriteCommittedSpanOutboxPayloadSchema,
}).superRefine((report, context) => {
  const intent = report.intent;
  if (intent.status !== "committed") {
    context.addIssue({code:"custom",message:"atomic report requires a committed intent"});return;
  }
  const outcome = report.attempt.outcome;
  const ordinary = outcome.state === "committed" && outcome.confirmedAt === intent.confirmedAt
    && canonicalJsonStringify(outcome.completionProof) === canonicalJsonStringify(intent.completionProof);
  const resolved = outcome.state === "parked" && intent.resolution !== undefined
    && intent.resolution.writeAttemptId === report.attempt.writeAttemptId && intent.resolution.decision === "present"
    && report.transaction.proofSource === "recovery-probe";
  if ((!ordinary && !resolved) || !AtomicWriteCommitInputSchema.safeParse({writeIntentId:intent.writeIntentId,
    generation:intent.generation,completionProof:intent.completionProof,confirmedAt:intent.confirmedAt,
    outcome:report.committedSpan.outcome,transaction:report.transaction,committedSpan:report.committedSpan}).success
    || report.attempt.writeIntentId !== intent.writeIntentId || report.attempt.writeAttemptId !== intent.currentAttemptId
    || report.attempt.generation !== intent.generation || report.attempt.runId !== report.transaction.runId
    || report.attempt.runAttempt !== report.transaction.attempt) context.addIssue({code:"custom",message:"atomic report exact evidence mismatch"});
});

export const ResolvedParkedWriteCommitInputSchema = z.strictObject({
  commit:AtomicWriteCommitInputSchema,checkpoint:RunCheckpointRecordSchema,
  expectedIntentVersion:PositiveIntSchema,resolution:ParkedWriteResolutionBindingSchema,
  claim: RunClaimTokenSchema,
});

export const ResolvedParkedWriteAbsenceInputSchema = z.strictObject({
  writeIntentId:WriteIntentIdSchema,generation:PositiveIntSchema,expectedIntentVersion:PositiveIntSchema,
  settlement:WriteRetrySettlementSchema,resolution:ParkedWriteResolutionBindingSchema,
});

/** Ref write-safety park codes — mirrors the parked intent/run vocabulary exactly. */
export const WriteIntentParkCodeSchema = z.enum([
  "unknown",
  "ambiguous",
  "present-proof-invalid",
  "binding-invalid",
  "operator-required",
]);

/** CAS an `attempting` intent (and its current attempt) to `parked`. */
export const WriteIntentParkRequestSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  expectedVersion: PositiveIntSchema,
  code: WriteIntentParkCodeSchema,
  message: z.string().min(1),
  authorityReason: WriteAuthorityReasonSchema,
  now: IsoInstantSchema,
});

export const WriteRecheckRequestSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema, generation: PositiveIntSchema, expectedVersion: PositiveIntSchema,
  recheck: ParkedWriteRecheckSchema,
});
export const WriteRecheckParkRequestSchema = WriteIntentParkRequestSchema.safeExtend({
  commandId: ParkedWriteRecheckSchema.shape.commandId,
});

// Retryable settlement requires typed stabilized absence or an explicit operator resolution.
export const WriteIntentRetrySettlementRequestSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  expectedVersion: PositiveIntSchema,
  settlement: WriteRetrySettlementSchema,
  now: IsoInstantSchema,
}).superRefine((request, context) => {
  if (request.settlement.writeIntentId !== request.writeIntentId) {
    context.addIssue({ code: "custom", path: ["settlement", "writeIntentId"], message: "settlement must name the exact intent it resolves" });
  }
  if (request.settlement.generation !== request.generation) {
    context.addIssue({ code: "custom", path: ["settlement", "generation"], message: "settlement must resolve the exact prior generation" });
  }
});


export const WriteRefenceInputSchema = z.strictObject({
  expectedVersion: PositiveIntSchema,
  claim: RunClaimTokenSchema,
  intent: WriteIntentRecordSchema,
  attempt: WriteAttemptRecordSchema,
}).superRefine(({ intent, attempt }, context) => {
  const fence = WriteFenceRecordsSchema.safeParse({ intent, attempt });
  if (!fence.success) {
    context.addIssue({ code: "custom", message: "a re-fence must contain one semantically consistent attempting intent and attempt" });
  }
});

/* ── the beat-⑦ outer bundle (ref dashboard-surfaces Phase-1f authority; ref write-safety beat ⑦) ── */

export const SequencedWriteCommitStepSchema = z.enum([
  "commit-write-attempt",
  "transaction-checkpoint",
  "run-transition",
]);

// Keep the narrow write primitive inside the complete atomic settlement bundle.
export const SequencedWriteCommitInputSchema = z.strictObject({
  run: z.strictObject({
    runId: RunIdSchema,
    expectedVersion: PositiveIntSchema,
    /** Present for the claim-holding executor arm; absent for the parked-write resume arms. */
    claim: RunClaimTokenSchema.optional(),
  }),
  checkpoint: RunCheckpointRecordSchema,
  commit: AtomicWriteCommitInputSchema,
}).superRefine((input, context) => {
  const entry = input.commit.transaction;
  if (input.run.runId !== entry.runId) {
    context.addIssue({ code: "custom", path: ["run", "runId"], message: "beat-⑦ run must be the exact run the ledger entry names" });
  }
  for (const [field, checkpointValue, entryValue] of [
    ["runId", input.checkpoint.runId, entry.runId],
    ["workflowId", input.checkpoint.workflowId, entry.workflowId],
    ["itemId", input.checkpoint.itemId, entry.itemId],
    ["attempt", input.checkpoint.attempt, entry.attempt],
  ] as const) {
    if (checkpointValue !== entryValue) {
      context.addIssue({ code: "custom", path: ["checkpoint", field], message: `checkpoint ${field} must match the committed ledger entry` });
    }
  }
  if (canonicalJsonStringify(input.checkpoint.output.value) !== canonicalJsonStringify(input.commit.outcome)) {
    context.addIssue({ code: "custom", path: ["checkpoint", "output", "value"], message: "checkpoint value must be the exact durable transaction outcome" });
  }
  if (input.checkpoint.writtenAt !== input.commit.confirmedAt) {
    context.addIssue({ code: "custom", path: ["checkpoint", "writtenAt"], message: "checkpoint must be written at the atomic confirmation instant" });
  }
});

export type WriteFenceInput = z.infer<typeof WriteFenceInputSchema>;
export type PermanentWriteResolution = z.infer<typeof PermanentWriteResolutionSchema>;
export type AtomicWriteCommitStorageStep = z.infer<typeof AtomicWriteCommitStorageStepSchema>;
export type AtomicWriteCommitInput = z.infer<typeof AtomicWriteCommitInputSchema>;
export type AtomicWriteCommitReport = z.infer<typeof AtomicWriteCommitReportSchema>;
export type WriteIntentParkCode = z.infer<typeof WriteIntentParkCodeSchema>;
export type WriteIntentParkRequest = z.infer<typeof WriteIntentParkRequestSchema>;
export type WriteIntentRetrySettlementRequest = z.infer<typeof WriteIntentRetrySettlementRequestSchema>;
export type WriteRefenceInput = z.infer<typeof WriteRefenceInputSchema>;
export type SequencedWriteCommitStep = z.infer<typeof SequencedWriteCommitStepSchema>;
export type SequencedWriteCommitInput = z.infer<typeof SequencedWriteCommitInputSchema>;
