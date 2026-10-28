import { localDatePart } from "../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { lifecycleCommandId } from "../../rules/identity/identifiers.js";
import { LedgerEntryPayloadSchema, WriteCommittedSpanOutboxPayloadSchema } from "../../rules/runs/ledger.js";
import { authenticateParkedWriteResolution } from "../../rules/write-safety/parked-resolution.js";
import { TransactionOutcomeSchema } from "../../rules/write-safety/write-safety-primitives.js";
import { TimelineAppendSchema, timelineCheckpointReference, type TimelineEventRecord } from "./timeline.js";
import type { WriteAttemptRecord, WriteIntentRecord } from "../../rules/write-safety/write-safety.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../workflow/checkpoint.js";
import { z } from "zod";

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

export const ConfirmationPublicationSchema = z.strictObject({
  format: z.literal(1),
  ledger: LedgerEntryPayloadSchema,
  span: WriteCommittedSpanOutboxPayloadSchema,
  checkpoint: RunCheckpointRecordSchema,
  timeline: TimelineAppendSchema,
}).superRefine((publication, context) => {
  const { ledger, span, checkpoint, timeline } = publication;
  if (timeline.payload.kind !== "operation-confirmed"
    || canonicalJsonStringify(confirmedOperationTimeline({ledger,span,checkpoint,
      writeAttemptId:timeline.payload.writeAttemptId,recordedAt:timeline.recordedAt})) !== canonicalJsonStringify(timeline)) {
    context.addIssue({code:"custom",message:"confirmation publication must preserve its exact native timeline"});
  }
  if(checkpoint.runId!==ledger.runId || checkpoint.workflowId!==ledger.workflowId
    || checkpoint.itemId!==ledger.itemId || checkpoint.attempt!==ledger.attempt){
    context.addIssue({code:"custom",message:"confirmation publication checkpoint owner mismatch"});
  }
  const outcome = TransactionOutcomeSchema.safeParse(checkpoint.output.value);
  if (!outcome.success || outcome.data.disposition !== "committed" || checkpoint.writtenAt !== ledger.confirmedAt
    || canonicalJsonStringify(outcome.data) !== canonicalJsonStringify(span.outcome)
    || span.outcome.disposition !== "committed" || span.outcome.confirmedAt !== ledger.confirmedAt
    || span.outcome.proofSource !== ledger.proofSource
    || canonicalJsonStringify(span.outcome.proof) !== canonicalJsonStringify(ledger.proof)) {
    context.addIssue({code:"custom",message:"confirmation publication must preserve the complete committed outcome"});
  }
  for (const key of ["writeIntentId","intentGeneration","runId","traceId","workflowId","itemId","attempt","system",
    "idempotencyKey","idempotencyKeyDigest","bindingProofDigest"] as const) {
    if (ledger[key] !== span[key]) context.addIssue({code:"custom",message:"confirmation publication span identity mismatch"});
  }
});
export type ConfirmationPublication = z.infer<typeof ConfirmationPublicationSchema>;

export function confirmationPublicationFromRow(intent: WriteIntentRecord, json: unknown): ConfirmationPublication | undefined {
  if (intent.status !== "committed") {
    if (json !== null) throw new Error("unconfirmed-write-publication-forbidden");
    return undefined;
  }
  const publication = ConfirmationPublicationSchema.parse(JSON.parse(z.string().parse(json)));
  const facts = publication.ledger;
  for (const [actual,expected] of [[facts.writeIntentId,intent.writeIntentId],[facts.intentGeneration,intent.generation],
    [facts.runId,intent.runId],[facts.workflowId,intent.workflowId],[facts.itemId,intent.itemId],[facts.attempt,intent.runAttempt],
    [facts.system,intent.system],[facts.idempotencyKey,intent.idempotencyKey],[facts.idempotencyKeyDigest,intent.idempotencyKeyDigest],
    [facts.bindingProofDigest,intent.bindingProofDigest],[facts.fencedAt,intent.fencedAt],[facts.confirmedAt,intent.confirmedAt]]) {
    if (actual !== expected) throw new Error("confirmed-write-publication-intent-mismatch");
  }
  if (publication.timeline.payload.kind !== "operation-confirmed"
    || publication.timeline.payload.writeAttemptId !== intent.currentAttemptId
    || canonicalJsonStringify(facts.proof) !== canonicalJsonStringify(intent.completionProof)) throw new Error("confirmed-write-publication-proof-mismatch");
  return publication;
}

/** Lossless resolver; missing exact evidence never yields an empty history. */
export function reconstructConfirmedOperation(repositories: Readonly<{
  writeAttempts: { get(id: string): WriteAttemptRecord | undefined };
  writeIntents: { get(id: string): WriteIntentRecord | undefined; getPublication(id:string): ConfirmationPublication | undefined;
    authenticatedDeletion(runId:string, publication:ConfirmationPublication): boolean };
  commands: { get(id: string): unknown };
  commandAudits: { get(id: string): unknown };
  runCheckpoints: { get(workflowId: string, itemId: string, nodeId: string, attempt: number, claimGeneration: number): RunCheckpointRecord | undefined };
}>,
  record: Pick<TimelineEventRecord, "payload">) {
  if (record.payload.kind !== "operation-confirmed") throw new Error("confirmed-history-kind-required");
  const { facts, writeAttemptId, proofDigest, checkpoint: reference, spanOccurredAt } = record.payload;
  const attempt = repositories.writeAttempts.get(writeAttemptId);
  if (attempt === undefined || attempt.writeIntentId !== facts.writeIntentId || attempt.generation !== facts.intentGeneration
    || attempt.runId !== facts.runId || attempt.runAttempt !== facts.attempt
    || attempt.bindingProofDigest !== facts.bindingProofDigest || attempt.fencedAt !== facts.fencedAt) throw new Error("confirmed-history-attempt-mismatch");
  let confirmation;
  if (attempt.outcome.state === "committed") confirmation = {proof:attempt.outcome.completionProof,confirmedAt:attempt.outcome.confirmedAt};
  else if (attempt.outcome.state === "parked") {
    const intent = repositories.writeIntents.get(attempt.writeIntentId);
    if (intent?.status !== "committed" || intent.resolution === undefined || facts.proofSource !== "recovery-probe"
      || intent.idempotencyKey !== facts.idempotencyKey || intent.idempotencyKeyDigest !== facts.idempotencyKeyDigest) throw new Error("confirmed-history-parked-resolution-missing");
    authenticateParkedWriteResolution(intent,attempt,repositories.commands.get(intent.resolution.commandId),repositories.commandAudits.get(intent.resolution.auditId));
    confirmation = {proof:intent.completionProof,confirmedAt:intent.confirmedAt};
  } else throw new Error("confirmed-history-attempt-mismatch");
  if (confirmation.confirmedAt !== facts.confirmedAt || sha256Hex(canonicalJsonStringify(confirmation.proof)) !== proofDigest) throw new Error("confirmed-history-attempt-mismatch");
  const publication = repositories.writeIntents.getPublication(facts.writeIntentId);
  if (publication === undefined || canonicalJsonStringify(publication.timeline.payload) !== canonicalJsonStringify(record.payload)) {
    throw new Error("confirmed-history-publication-mismatch");
  }
  const storedCheckpoint = repositories.runCheckpoints.get(reference.workflowId, reference.itemId, reference.nodeId,
    reference.attempt, reference.claimGeneration);
  if (storedCheckpoint === undefined && !repositories.writeIntents.authenticatedDeletion(facts.runId,publication)) throw new Error("confirmed-history-checkpoint-missing");
  const checkpoint = storedCheckpoint ?? publication.checkpoint;
  if (canonicalJsonStringify(checkpoint) !== canonicalJsonStringify(publication.checkpoint)) throw new Error("confirmed-history-checkpoint-publication-mismatch");
  if(checkpoint.runId!==facts.runId || checkpoint.workflowId!==facts.workflowId
    || checkpoint.itemId!==facts.itemId || checkpoint.attempt!==facts.attempt)throw new Error("confirmed-history-checkpoint-owner-mismatch");
  if (checkpoint === undefined || checkpoint.writtenAt !== facts.confirmedAt
    || canonicalJsonStringify(timelineCheckpointReference(checkpoint)) !== canonicalJsonStringify(reference)) {
    throw new Error("confirmed-history-checkpoint-mismatch");
  }
  const parsedOutcome = TransactionOutcomeSchema.safeParse(checkpoint.output.value);
  if (!parsedOutcome.success) throw new Error("confirmed-history-outcome-invalid");
  const outcome = parsedOutcome.data;
  if (outcome.disposition !== "committed" || outcome.confirmedAt !== facts.confirmedAt
    || outcome.proofSource !== facts.proofSource
    || canonicalJsonStringify(outcome.proof) !== canonicalJsonStringify(confirmation.proof)) {
    throw new Error("confirmed-history-outcome-mismatch");
  }
  const ledger = LedgerEntryPayloadSchema.parse({ ...facts, proof: confirmation.proof });
  const span = WriteCommittedSpanOutboxPayloadSchema.parse({ kind: "write-committed-span",
    writeIntentId: facts.writeIntentId, intentGeneration: facts.intentGeneration, runId: facts.runId,
    traceId: facts.traceId, workflowId: facts.workflowId, itemId: facts.itemId, attempt: facts.attempt,
    system: facts.system, idempotencyKey: facts.idempotencyKey, idempotencyKeyDigest: facts.idempotencyKeyDigest,
    bindingProofDigest: facts.bindingProofDigest, occurredAt: spanOccurredAt, outcome });
  if (canonicalJsonStringify(ledger) !== canonicalJsonStringify(publication.ledger)
    || canonicalJsonStringify(span) !== canonicalJsonStringify(publication.span)) throw new Error("confirmed-history-publication-content-mismatch");
  return { ledger, span };
}
