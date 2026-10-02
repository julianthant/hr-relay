import { z } from "zod";
import { FingerprintSchema, IsoInstantSchema, OutboxIdSchema, PositiveIntSchema, WriteIntentIdSchema } from "../../rules/identity/ids.js";
import { LedgerOutboxPayloadSchema, WriteCommittedSpanOutboxPayloadSchema } from "../../rules/runs/ledger.js";

export const AtomicOutboxPayloadSchema = z.discriminatedUnion("kind", [
  LedgerOutboxPayloadSchema,
  WriteCommittedSpanOutboxPayloadSchema,
]);

const OutboxProjectionStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending") }),
  z.strictObject({ state: z.literal("projected"), projectedAt: IsoInstantSchema, projectionFingerprint: FingerprintSchema }),
]);

export const AtomicOutboxRecordSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  aggregate: z.strictObject({
    kind: z.literal("write-intent"),
    writeIntentId: WriteIntentIdSchema,
    generation: PositiveIntSchema,
  }),
  payload: AtomicOutboxPayloadSchema,
  projection: OutboxProjectionStateSchema,
  createdAt: IsoInstantSchema,
});

export type AtomicOutboxPayload = z.infer<typeof AtomicOutboxPayloadSchema>;
export type AtomicOutboxRecord = z.infer<typeof AtomicOutboxRecordSchema>;
