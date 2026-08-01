import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { PositiveIntSchema, WriteIntentIdSchema } from "../../domain/ids.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import { SchemaBoundCanonicalValueSchema } from "../../domain/schema-bound-value.js";
import {
  TransactionOutcomeSchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
} from "../../domain/write-safety.js";

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

export type WriteFenceInput = z.infer<typeof WriteFenceInputSchema>;
export type PermanentWriteResolution = z.infer<typeof PermanentWriteResolutionSchema>;
export type AtomicWriteCommitStorageStep = z.infer<typeof AtomicWriteCommitStorageStepSchema>;
export type AtomicWriteCommitInput = z.infer<typeof AtomicWriteCommitInputSchema>;
export type AtomicWriteCommitReport = z.infer<typeof AtomicWriteCommitReportSchema>;
