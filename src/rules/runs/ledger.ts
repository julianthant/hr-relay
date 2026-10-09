import { z } from "zod";
import {
  ActorIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NonNegativeIntSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "../identity/ids.js";
import { LedgerCompletionKindSchema, LedgerProofSourceSchema } from "./ledger-primitives.js";
import { SchemaBoundCanonicalValueSchema } from "../../models/validation/schema-bound-value.js";
import {
  IdempotencyKeySchema,
  SubjectEvidenceSchema,
  TransactionOutcomeSchema,
  deriveIdempotencyKeyDigest,
} from "../write-safety/write-safety.js";

const OptionalSubjectEvidenceSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("present"), value: SubjectEvidenceSchema }),
]);

const OptionalExternalInstantSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
]);

export const LedgerEntryPayloadSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  itemId: ItemIdSchema,
  system: BrowserSystemIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  idempotencyKeyDigest: FingerprintSchema,
  writeIntentId: WriteIntentIdSchema,
  intentGeneration: PositiveIntSchema,
  proof: SchemaBoundCanonicalValueSchema,
  completionKind: LedgerCompletionKindSchema,
  proofSource: LedgerProofSourceSchema,
  bindingProofDigest: FingerprintSchema,
  subject: OptionalSubjectEvidenceSchema,
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  attempt: PositiveIntSchema,
  operator: ActorIdSchema,
  instance: z.enum(["prod", "test"]),
  configFingerprint: FingerprintSchema,
  dryRun: z.literal(false),
  fencedAt: IsoInstantSchema,
  confirmedAt: IsoInstantSchema,
  externalOccurredAt: OptionalExternalInstantSchema,
}).superRefine((entry, context) => {
  if (Date.parse(entry.confirmedAt) < Date.parse(entry.fencedAt)) {
    context.addIssue({ code: "custom", path: ["confirmedAt"], message: "ledger confirmation cannot precede the write fence" });
  }
  if (entry.idempotencyKeyDigest !== deriveIdempotencyKeyDigest(entry.system, entry.idempotencyKey)) {
    context.addIssue({ code: "custom", path: ["idempotencyKeyDigest"], message: "ledger idempotency key digest does not match the exact system and natural key" });
  }
});

export const LedgerEntrySchema = z.strictObject({
  outboxId: OutboxIdSchema,
  seq: NonNegativeIntSchema,
  payload: LedgerEntryPayloadSchema,
});

export const LedgerOutboxPayloadSchema = z.strictObject({
  kind: z.literal("ledger-entry"),
  entry: LedgerEntryPayloadSchema,
});

export const WriteCommittedSpanOutboxPayloadSchema = z.strictObject({
  kind: z.literal("write-committed-span"),
  writeIntentId: WriteIntentIdSchema,
  intentGeneration: PositiveIntSchema,
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  itemId: ItemIdSchema,
  attempt: PositiveIntSchema,
  system: BrowserSystemIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  idempotencyKeyDigest: FingerprintSchema,
  bindingProofDigest: FingerprintSchema,
  occurredAt: IsoInstantSchema,
  outcome: TransactionOutcomeSchema,
}).superRefine((payload, context) => {
  if (payload.idempotencyKeyDigest !== deriveIdempotencyKeyDigest(payload.system, payload.idempotencyKey)) {
    context.addIssue({ code: "custom", path: ["idempotencyKeyDigest"], message: "span idempotency key digest does not match the exact system and natural key" });
  }
});

export type LedgerEntryPayload = z.infer<typeof LedgerEntryPayloadSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
