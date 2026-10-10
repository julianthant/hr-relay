/** Separate durable sequence, append and outbox marks permit crash repair between stages. */
import { z } from "zod";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  FingerprintSchema,
  IsoInstantSchema,
  LedgerProjectorIdSchema,
  NonNegativeIntSchema,
  OutboxIdSchema,
  PositiveIntSchema,
} from "../identity/ids.js";
import { LedgerEntrySchema } from "./ledger.js";
import { sha256Hex } from "../validation/sha256.js";

export const LedgerPartitionKeySchema = z.strictObject({
  system: BrowserSystemIdSchema,
  date: DateOnlySchema,
});

const LedgerLeaseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unleased") }),
  z.strictObject({
    state: z.literal("held"),
    holder: LedgerProjectorIdSchema,
    expiresAt: IsoInstantSchema,
  }),
]);

/** One row per `(system, date)`; `nextSeq` is the ONLY sequence authority, advanced inside the same transaction that writes the assignment row. */
export const LedgerPartitionRecordSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  date: DateOnlySchema,
  nextSeq: NonNegativeIntSchema,
  lease: LedgerLeaseSchema,
  leaseGeneration: NonNegativeIntSchema,
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
});

const LedgerProjectionLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("assigned") }),
  z.strictObject({ state: z.literal("appended"), appendedAt: IsoInstantSchema }),
]);

/** One row per projected `outboxId` — the projector's idempotency key, written BEFORE the file append so a crash still leaves the line text reconstructible. */
export const LedgerProjectionRecordSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  system: BrowserSystemIdSchema,
  date: DateOnlySchema,
  seq: NonNegativeIntSchema,
  lineDigest: FingerprintSchema,
  projectedBy: LedgerProjectorIdSchema,
  lifecycle: LedgerProjectionLifecycleSchema,
  assignedAt: IsoInstantSchema,
});

/** Every way the on-disk partition can disagree with authority; each one STOPS projection for that partition. */
export const LedgerDegradedReasonSchema = z.enum([
  "duplicate-sequence",
  "duplicate-outbox",
  "sequence-gap",
  "sequence-out-of-order",
  "malformed-tail",
  "line-digest-mismatch",
  "unrecorded-line",
  "sequence-authority-mismatch",
  "missing-outbox-payload",
]);

export const LedgerProjectionHealthSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("healthy") }),
  z.strictObject({
    state: z.literal("degraded"),
    reason: LedgerDegradedReasonSchema,
    detail: z.string().min(1),
  }),
]);

export const LedgerProjectionReportSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("projected"),
    partition: LedgerPartitionKeySchema,
    appended: z.array(LedgerProjectionRecordSchema),
    repaired: z.array(LedgerProjectionRecordSchema),
    remarked: z.array(OutboxIdSchema),
    nextSeq: NonNegativeIntSchema,
  }),
  z.strictObject({
    state: z.literal("lease-held"),
    partition: LedgerPartitionKeySchema,
    holder: LedgerProjectorIdSchema,
    expiresAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("degraded"),
    partition: LedgerPartitionKeySchema,
    reason: LedgerDegradedReasonSchema,
    detail: z.string().min(1),
  }),
]);

export const LedgerLeaseOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("acquired"), partition: LedgerPartitionRecordSchema }),
  z.strictObject({ state: z.literal("held"), partition: LedgerPartitionRecordSchema }),
]);

/** The durable key of a `(system, date)` partition row. */
export function ledgerPartitionRecordKey(system: string, date: string): string {
  const key = LedgerPartitionKeySchema.parse({ system, date });
  return `${key.system}:${key.date}`;
}

/** The partition a committed entry belongs to, derived from the entry's OWN `confirmedAt` in UTC, so a later restart reconciles into the same file. */
export function ledgerPartitionOfInstant(confirmedAt: string): string {
  const instant = IsoInstantSchema.parse(confirmedAt);
  const parsed = new Date(Date.parse(instant));
  return DateOnlySchema.parse(parsed.toISOString().slice(0, 10));
}

/** The exact bytes one ledger line carries, minus its terminating newline. */
export function ledgerLineText(entry: unknown): string {
  return canonicalJsonStringify(LedgerEntrySchema.parse(entry));
}

/** A versioned domain separator keeps a line digest from colliding with any other hash. */
export function deriveLedgerLineDigest(line: string): string {
  return FingerprintSchema.parse(sha256Hex(`hrauto:ledger-line:v1\u0000${line}`));
}

export type LedgerPartitionKey = z.infer<typeof LedgerPartitionKeySchema>;
export type LedgerPartitionRecord = z.infer<typeof LedgerPartitionRecordSchema>;
export type LedgerProjectionRecord = z.infer<typeof LedgerProjectionRecordSchema>;
export type LedgerProjectionHealth = z.infer<typeof LedgerProjectionHealthSchema>;
export type LedgerProjectionReport = z.infer<typeof LedgerProjectionReportSchema>;
export type LedgerLeaseOutcome = z.infer<typeof LedgerLeaseOutcomeSchema>;
export type LedgerDegradedReason = z.infer<typeof LedgerDegradedReasonSchema>;
