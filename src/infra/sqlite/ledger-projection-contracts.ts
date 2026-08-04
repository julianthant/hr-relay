/**
 * Doc 09 §6. The four requests the serialized ledger projector makes of
 * authority. Each one names the exact lease generation it believes it holds, so
 * a projector whose lease expired under it cannot advance a sequence or mark a
 * line appended.
 */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  FingerprintSchema,
  IsoInstantSchema,
  LedgerProjectorIdSchema,
  PositiveIntSchema,
  OutboxIdSchema,
} from "../../domain/ids.js";

const PARTITION_TARGET_FIELDS = {
  system: BrowserSystemIdSchema,
  date: DateOnlySchema,
  projectorId: LedgerProjectorIdSchema,
} as const;

export const LedgerLeaseRequestSchema = z.strictObject({
  ...PARTITION_TARGET_FIELDS,
  now: IsoInstantSchema,
  expiresAt: IsoInstantSchema,
}).superRefine((request, context) => {
  if (Date.parse(request.expiresAt) <= Date.parse(request.now)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "a ledger lease must expire after it is taken" });
  }
});

export const LedgerReleaseRequestSchema = z.strictObject({
  ...PARTITION_TARGET_FIELDS,
  leaseGeneration: PositiveIntSchema,
  now: IsoInstantSchema,
});

export const LedgerSequenceAssignmentSchema = z.strictObject({
  ...PARTITION_TARGET_FIELDS,
  leaseGeneration: PositiveIntSchema,
  outboxId: OutboxIdSchema,
  lineDigest: FingerprintSchema,
  assignedAt: IsoInstantSchema,
});

export const LedgerAppendConfirmationSchema = z.strictObject({
  ...PARTITION_TARGET_FIELDS,
  leaseGeneration: PositiveIntSchema,
  outboxId: OutboxIdSchema,
  lineDigest: FingerprintSchema,
  appendedAt: IsoInstantSchema,
});

export type LedgerLeaseRequest = z.infer<typeof LedgerLeaseRequestSchema>;
export type LedgerReleaseRequest = z.infer<typeof LedgerReleaseRequestSchema>;
export type LedgerSequenceAssignment = z.infer<typeof LedgerSequenceAssignmentSchema>;
export type LedgerAppendConfirmation = z.infer<typeof LedgerAppendConfirmationSchema>;
