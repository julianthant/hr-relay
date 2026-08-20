/**
 * Ref write-safety §6's ordered, actor-attributed ledger projection — the durable half.
 *
 * Beat ⑦ writes an UNSEQUENCED `ledger-entry` outbox row inside the atomic
 * write-commit transaction. Exactly one projector then holds a lease on the
 * entry's `(system, date)` partition, assigns the next `seq`, appends one
 * canonical line to `<stateRoot>/ledger/<system>-<date>.jsonl`, fsyncs, and
 * marks the outbox projected. Those three facts are separately durable on
 * purpose: a crash between any two of them must be repairable from what is
 * already stored, never from a guess.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  FingerprintSchema,
  IsoInstantSchema,
  LedgerProjectorIdSchema,
  NonNegativeIntSchema,
  OutboxIdSchema,
  PositiveIntSchema,
} from "./ids.js";
import { LedgerEntrySchema } from "./ledger.js";
import { sha256Hex } from "./sha256.js";

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

/**
 * One row per `(system, date)`. `nextSeq` is the ONLY sequence authority: it is
 * advanced inside the same authority transaction that writes the assignment
 * row, so two projectors racing the same partition cannot mint one `seq` twice
 * even if the lease were somehow held twice.
 */
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

/**
 * One row per projected `outboxId` — the projector's idempotency key. The row
 * is written BEFORE the file append, so a crash in the append window leaves an
 * `assigned` row whose exact line text is still reconstructible from the outbox
 * payload plus this `seq`; recovery re-derives it and compares `lineDigest`
 * rather than inventing a replacement.
 */
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

/**
 * Every way the on-disk partition can disagree with authority. Each one STOPS
 * projection for that partition: ref write-safety §6 forbids rewriting or skipping past a
 * ledger inconsistency, because the ledger is the record of what was really
 * filed against a live HR system.
 */
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

/**
 * The partition a committed entry belongs to, derived from the entry's OWN
 * `confirmedAt` rather than from wall-clock time at projection: a restart hours
 * or days later must reconcile into the same file. UTC, not local, so the
 * partition of a stored entry never depends on the machine's time zone (the
 * same reason D112 fixes provider budget windows to UTC).
 */
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
