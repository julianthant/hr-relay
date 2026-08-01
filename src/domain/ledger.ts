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
} from "./ids.js";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";
import { SubjectEvidenceSchema } from "./write-safety.js";

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
  idempotencyKeyDigest: FingerprintSchema,
  writeIntentId: WriteIntentIdSchema,
  intentGeneration: PositiveIntSchema,
  proof: SchemaBoundCanonicalValueSchema,
  completionKind: z.enum(["receipt", "save-verify", "upload-verify"]),
  proofSource: z.enum(["normal-output", "recovery-probe", "operator-attestation"]),
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
  idempotencyKeyDigest: FingerprintSchema,
  bindingProofDigest: FingerprintSchema,
  occurredAt: IsoInstantSchema,
});

export type LedgerEntryPayload = z.infer<typeof LedgerEntryPayloadSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
