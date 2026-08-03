import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import {
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  WriteIntentIdSchema,
} from "../../domain/ids.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import { RunCheckpointRecordSchema } from "../../domain/workflow/checkpoint.js";
import { SchemaBoundCanonicalValueSchema } from "../../domain/schema-bound-value.js";
import {
  TransactionOutcomeSchema,
  WriteRetrySettlementSchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
} from "../../domain/write-safety.js";
import { RunClaimTokenSchema } from "./run-store-contracts.js";

export const WriteFenceInputSchema = z.strictObject({
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

export const PermanentWriteResolutionSchema = z.discriminatedUnion("state", [
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
    const fence = WriteFenceInputSchema.safeParse({ intent: resolution.intent, attempt: resolution.attempt });
    if (!fence.success) {
      context.addIssue({ code: "custom", message: "fenced resolution must contain one semantically consistent intent and attempt" });
    }
  }
  if (resolution.state === "recorded-observed-present" && resolution.intent.status !== "observed-present") {
    context.addIssue({ code: "custom", path: ["intent", "status"], message: "observed-present resolution requires an observed-present intent" });
  }
});

export const AtomicWriteCommitStorageStepSchema = z.enum([
  "intent-state",
  "attempt-state",
  "ledger-outbox",
  "terminal-span-outbox",
]);

export const AtomicWriteCommitInputSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  completionProof: SchemaBoundCanonicalValueSchema,
  confirmedAt: z.iso.datetime({ offset: true }),
  outcome: TransactionOutcomeSchema,
  ledgerOutbox: AtomicOutboxRecordSchema,
  terminalSpanOutbox: AtomicOutboxRecordSchema,
}).superRefine((input, context) => {
  if (input.outcome.disposition !== "committed") {
    context.addIssue({ code: "custom", path: ["outcome", "disposition"], message: "atomic write commit requires a committed transaction outcome" });
  } else {
    if (canonicalJsonStringify(input.completionProof) !== canonicalJsonStringify(input.outcome.proof)) {
      context.addIssue({ code: "custom", path: ["outcome", "proof"], message: "outcome proof must equal the accepted completion proof" });
    }
    if (input.confirmedAt !== input.outcome.confirmedAt) {
      context.addIssue({ code: "custom", path: ["outcome", "confirmedAt"], message: "outcome confirmation time must equal the atomic commit time" });
    }
  }
  if (input.ledgerOutbox.payload.kind !== "ledger-entry") {
    context.addIssue({ code: "custom", path: ["ledgerOutbox", "payload", "kind"], message: "ledgerOutbox must carry the ledger-entry arm" });
  } else {
    if (canonicalJsonStringify(input.ledgerOutbox.payload.entry.proof) !== canonicalJsonStringify(input.completionProof)) {
      context.addIssue({ code: "custom", path: ["ledgerOutbox", "payload", "entry", "proof"], message: "ledger proof must equal the accepted completion proof" });
    }
    if (input.outcome.disposition === "committed"
      && (input.ledgerOutbox.payload.entry.proofSource !== input.outcome.proofSource
        || input.ledgerOutbox.payload.entry.confirmedAt !== input.confirmedAt)) {
      context.addIssue({ code: "custom", path: ["ledgerOutbox", "payload", "entry"], message: "ledger proof source and confirmation time must match the committed outcome" });
    }
  }
  if (input.terminalSpanOutbox.payload.kind !== "write-committed-span") {
    context.addIssue({ code: "custom", path: ["terminalSpanOutbox", "payload", "kind"], message: "terminalSpanOutbox must carry the write-committed-span arm" });
  } else if (canonicalJsonStringify(input.terminalSpanOutbox.payload.outcome) !== canonicalJsonStringify(input.outcome)) {
    context.addIssue({ code: "custom", path: ["terminalSpanOutbox", "payload", "outcome"], message: "terminal span outcome must equal the generic committed outcome shell" });
  }
  if (input.ledgerOutbox.payload.kind === "ledger-entry"
    && input.terminalSpanOutbox.payload.kind === "write-committed-span"
    && input.ledgerOutbox.payload.entry.traceId !== input.terminalSpanOutbox.payload.traceId) {
    context.addIssue({ code: "custom", path: ["terminalSpanOutbox", "payload", "traceId"], message: "ledger and terminal span outboxes must carry the same trace identity" });
  }
  if (input.ledgerOutbox.outboxId === input.terminalSpanOutbox.outboxId) {
    context.addIssue({ code: "custom", path: ["terminalSpanOutbox", "outboxId"], message: "ledger and terminal span outboxes require distinct ids" });
  }
  for (const [name, outbox] of [
    ["ledgerOutbox", input.ledgerOutbox],
    ["terminalSpanOutbox", input.terminalSpanOutbox],
  ] as const) {
    if (outbox.aggregate.writeIntentId !== input.writeIntentId) {
      context.addIssue({ code: "custom", path: [name, "aggregate", "writeIntentId"], message: "outbox aggregate must match the committed intent" });
    }
    if (outbox.aggregate.generation !== input.generation) {
      context.addIssue({ code: "custom", path: [name, "aggregate", "generation"], message: "outbox generation must match the committed intent" });
    }
  }
});

export const AtomicWriteCommitReportSchema = z.strictObject({
  state: z.literal("committed"),
  intent: WriteIntentRecordSchema,
  attempt: WriteAttemptRecordSchema,
  ledgerOutbox: AtomicOutboxRecordSchema,
  terminalSpanOutbox: AtomicOutboxRecordSchema,
}).superRefine((report, context) => {
  if (report.intent.status !== "committed") {
    context.addIssue({ code: "custom", path: ["intent", "status"], message: "atomic commit report intent must be committed" });
    return;
  }
  if (report.attempt.outcome.state !== "committed") {
    context.addIssue({ code: "custom", path: ["attempt", "outcome"], message: "atomic commit report attempt must be committed" });
    return;
  }
  if (report.ledgerOutbox.payload.kind !== "ledger-entry") {
    context.addIssue({ code: "custom", path: ["ledgerOutbox", "payload", "kind"], message: "atomic commit report requires a ledger-entry outbox" });
  }
  if (report.terminalSpanOutbox.payload.kind !== "write-committed-span") {
    context.addIssue({ code: "custom", path: ["terminalSpanOutbox", "payload", "kind"], message: "atomic commit report requires a terminal-span outbox" });
    return;
  }
  if (report.ledgerOutbox.payload.kind !== "ledger-entry") return;
  const commitInput = AtomicWriteCommitInputSchema.safeParse({
    writeIntentId: report.intent.writeIntentId,
    generation: report.intent.generation,
    completionProof: report.intent.completionProof,
    confirmedAt: report.intent.confirmedAt,
    outcome: report.terminalSpanOutbox.payload.outcome,
    ledgerOutbox: report.ledgerOutbox,
    terminalSpanOutbox: report.terminalSpanOutbox,
  });
  if (!commitInput.success) {
    context.addIssue({ code: "custom", message: "atomic commit report outboxes must form one valid commit input" });
  }
  if (report.attempt.writeIntentId !== report.intent.writeIntentId
    || report.attempt.writeAttemptId !== report.intent.currentAttemptId
    || report.attempt.generation !== report.intent.generation
    || canonicalJsonStringify(report.attempt.outcome.completionProof) !== canonicalJsonStringify(report.intent.completionProof)
    || report.attempt.outcome.confirmedAt !== report.intent.confirmedAt) {
    context.addIssue({ code: "custom", path: ["attempt"], message: "atomic commit report attempt must exactly match the committed intent" });
  }
});

/* ── Phase-1f intent state transitions (doc 09 §4/§4.1; D111/D118) ────────── */

/** Doc 09 §4.3 park codes — mirrors the parked intent/run vocabulary exactly. */
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
  now: IsoInstantSchema,
});

/**
 * CAS an `attempting` or `parked` intent to `retryable` with its typed
 * settlement — D64/D69 stabilized negative evidence, or the operator's
 * confirmed-absent resolution. History is retained on the attempt row;
 * only the NEXT fence may create a new generation.
 */
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

/**
 * CAS a `parked` intent (and attempt) back to `attempting` so the atomic
 * commit primitive can accept an operator confirmed-present resolution.
 * Restores the exact pre-park attempting shape; the primitive re-validates.
 */
export const WriteIntentReopenRequestSchema = z.strictObject({
  writeIntentId: WriteIntentIdSchema,
  generation: PositiveIntSchema,
  expectedVersion: PositiveIntSchema,
  now: IsoInstantSchema,
});

/**
 * CAS a `retryable` permanent row to a NEW `attempting` generation. The intent
 * keeps its permanent identity (same id/system/key); the generation advances by
 * exactly one and carries a FRESH binding proof — no prior `WriteBindingProof`
 * is ever reused across generations (doc 09 §4.1.2).
 */
export const WriteRefenceInputSchema = z.strictObject({
  expectedVersion: PositiveIntSchema,
  intent: WriteIntentRecordSchema,
  attempt: WriteAttemptRecordSchema,
}).superRefine(({ intent, attempt }, context) => {
  const fence = WriteFenceInputSchema.safeParse({ intent, attempt });
  if (!fence.success) {
    context.addIssue({ code: "custom", message: "a re-fence must contain one semantically consistent attempting intent and attempt" });
  }
});

/* ── the beat-⑦ outer bundle (doc 03 Phase-1f authority; doc 09 §3 beat ⑦) ── */

export const SequencedWriteCommitStepSchema = z.enum([
  "commit-write-attempt",
  "transaction-checkpoint",
  "run-transition",
]);

/**
 * The complete beat-⑦ bundle. The Phase-1c four-row `commitWriteAttempt`
 * primitive stays narrow INSIDE it (doc 03: "a storage primitive inside this
 * complete bundle, not a separately committable terminal path"); this outer
 * input additionally binds the current run claim, the schema-valid
 * `TransactionOutcome` checkpoint, and the run transition — one outer authority
 * transaction commits all of it or none.
 *
 * An evidence-receipt ref is deliberately ABSENT from this shape: the 2g trust
 * service is not active, and a missing receipt is represented as absent, never
 * fabricated. When 2g activates its terminal-receipt invariant this schema
 * gains the required ref in the same commit.
 */
export const SequencedWriteCommitInputSchema = z.strictObject({
  run: z.strictObject({
    runId: RunIdSchema,
    expectedVersion: PositiveIntSchema,
    claim: RunClaimTokenSchema,
  }),
  checkpoint: RunCheckpointRecordSchema,
  commit: AtomicWriteCommitInputSchema,
}).superRefine((input, context) => {
  const ledger = input.commit.ledgerOutbox.payload;
  if (ledger.kind !== "ledger-entry") return; // already refused by the inner schema
  const { entry } = ledger;
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
export type WriteIntentReopenRequest = z.infer<typeof WriteIntentReopenRequestSchema>;
export type WriteRefenceInput = z.infer<typeof WriteRefenceInputSchema>;
export type SequencedWriteCommitStep = z.infer<typeof SequencedWriteCommitStepSchema>;
export type SequencedWriteCommitInput = z.infer<typeof SequencedWriteCommitInputSchema>;
