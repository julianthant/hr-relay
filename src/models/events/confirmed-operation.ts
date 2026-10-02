import { localDatePart } from "../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { lifecycleCommandId } from "../../rules/identity/identifiers.js";
import { LedgerEntryPayloadSchema, WriteCommittedSpanOutboxPayloadSchema } from "../../rules/runs/ledger.js";
import { TransactionOutcomeSchema } from "../../rules/write-safety/write-safety.js";
import { TimelineAppendSchema, timelineCheckpointReference, type TimelineEventRecord } from "./timeline.js";
import type { WriteAttemptRecord } from "../../rules/write-safety/write-safety.js";
import type { RunCheckpointRecord } from "../workflow/checkpoint.js";
import type { z } from "zod";

/** Complete beat-seven evidence, referenced without duplicating immutable proof/output. */
export function confirmedOperationTimeline(input: Readonly<{
  ledger: z.infer<typeof LedgerEntryPayloadSchema>;
  span: z.infer<typeof WriteCommittedSpanOutboxPayloadSchema>;
  checkpoint: RunCheckpointRecord;
  writeAttemptId: string;
  recordedAt: string;
}>) {
  const { span, writeAttemptId } = input;
  const { proof, ...facts } = input.ledger;
  return TimelineAppendSchema.parse({ schemaVersion: 1,
    eventId: lifecycleCommandId("timeline-operation-confirmed", {
      writeIntentId: facts.writeIntentId, generation: facts.intentGeneration,
    }),
    workflow: facts.workflowId, scope: { kind: "run", runId: facts.runId },
    occurredAt: facts.confirmedAt, recordedAt: input.recordedAt,
    retentionDate: localDatePart(new Date(input.recordedAt)), source: { kind: "native" },
    payload: { kind: "operation-confirmed", facts, writeAttemptId,
      proofDigest: sha256Hex(canonicalJsonStringify(proof)), checkpoint: timelineCheckpointReference(input.checkpoint),
      spanOccurredAt: span.occurredAt },
  });
}

/** T2 consumes this lossless resolver; missing exact evidence never yields an empty history. */
export function reconstructConfirmedOperation(repositories: Readonly<{
  writeAttempts: { get(id: string): WriteAttemptRecord | undefined };
  runCheckpoints: { get(workflowId: string, itemId: string, nodeId: string, attempt: number, claimGeneration?: number): RunCheckpointRecord | undefined };
}>,
  record: Pick<TimelineEventRecord, "payload">) {
  if (record.payload.kind !== "operation-confirmed") throw new Error("confirmed-history-kind-required");
  const { facts, writeAttemptId, proofDigest, checkpoint: reference, spanOccurredAt } = record.payload;
  const attempt = repositories.writeAttempts.get(writeAttemptId);
  if (attempt === undefined || attempt.outcome.state !== "committed"
    || attempt.writeIntentId !== facts.writeIntentId || attempt.generation !== facts.intentGeneration
    || attempt.runId !== facts.runId || attempt.runAttempt !== facts.attempt
    || attempt.bindingProofDigest !== facts.bindingProofDigest || attempt.fencedAt !== facts.fencedAt
    || attempt.outcome.confirmedAt !== facts.confirmedAt
    || sha256Hex(canonicalJsonStringify(attempt.outcome.completionProof)) !== proofDigest) {
    throw new Error("confirmed-history-attempt-mismatch");
  }
  const checkpoint = repositories.runCheckpoints.get(reference.workflowId, reference.itemId, reference.nodeId,
    reference.attempt, reference.claimGeneration);
  if (checkpoint === undefined || checkpoint.writtenAt !== facts.confirmedAt
    || canonicalJsonStringify(timelineCheckpointReference(checkpoint)) !== canonicalJsonStringify(reference)) {
    throw new Error("confirmed-history-checkpoint-mismatch");
  }
  const parsedOutcome = TransactionOutcomeSchema.safeParse(checkpoint.output.value);
  if (!parsedOutcome.success) throw new Error("confirmed-history-outcome-invalid");
  const outcome = parsedOutcome.data;
  if (outcome.disposition !== "committed" || outcome.confirmedAt !== facts.confirmedAt
    || outcome.proofSource !== facts.proofSource
    || canonicalJsonStringify(outcome.proof) !== canonicalJsonStringify(attempt.outcome.completionProof)) {
    throw new Error("confirmed-history-outcome-mismatch");
  }
  const ledger = LedgerEntryPayloadSchema.parse({ ...facts, proof: attempt.outcome.completionProof });
  const span = WriteCommittedSpanOutboxPayloadSchema.parse({ kind: "write-committed-span",
    writeIntentId: facts.writeIntentId, intentGeneration: facts.intentGeneration, runId: facts.runId,
    traceId: facts.traceId, workflowId: facts.workflowId, itemId: facts.itemId, attempt: facts.attempt,
    system: facts.system, idempotencyKey: facts.idempotencyKey, idempotencyKeyDigest: facts.idempotencyKeyDigest,
    bindingProofDigest: facts.bindingProofDigest, occurredAt: spanOccurredAt, outcome });
  return { ledger, span };
}
