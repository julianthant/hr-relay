import { z } from "zod";
import { ProviderRunNodeExecutionIdentitySchema, HistoricalProviderExecutionIdentitySchema, HistoricalProviderCapabilitySchema } from "../../models/providers/historical-provider-evidence.js";
import { ProviderBudgetSchema } from "../../models/config/schema.js";
import { ConfigSnapshotIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, ProviderAdmissionIdSchema, ProviderCapabilityIdSchema } from "../identity/ids.js";

export const ProviderUnavailableCodeSchema = z.enum([
  "concurrency-exhausted",
  "rate-exhausted",
  "daily-request-exhausted",
  "daily-cost-exhausted",
  "aborted",
  "timeout",
  "adapter-unavailable",
]);

const RETRYABLE_PROVIDER_CODES = new Set<z.infer<typeof ProviderUnavailableCodeSchema>>([
  "concurrency-exhausted",
  "rate-exhausted",
  "daily-request-exhausted",
  "daily-cost-exhausted",
]);

export const ProviderUnavailableReasonSchema = z.strictObject({
  code: ProviderUnavailableCodeSchema,
  message: z.string().min(1),
  retryAt: IsoInstantSchema.optional(),
}).superRefine((reason, context) => {
  const retryable = RETRYABLE_PROVIDER_CODES.has(reason.code);
  if (retryable && reason.retryAt === undefined) {
    context.addIssue({ code: "custom", path: ["retryAt"], message: `${reason.code} requires retryAt` });
  }
  if (!retryable && reason.retryAt !== undefined) {
    context.addIssue({ code: "custom", path: ["retryAt"], message: `${reason.code} cannot carry retryAt` });
  }
});

export const ProviderCostEstimateSchema = z.strictObject({
  maximumCostUsdMicros: z.number().int().nonnegative(),
});

export const ProviderMeasuredUsageSchema = z.strictObject({
  requestCount: z.literal(1),
  costUsdMicros: z.number().int().nonnegative(),
});

/** Evidence values have already crossed the provider adapter's redaction boundary. */
export const RedactedProviderEvidenceSchema = z.strictObject({
  summary: z.string().min(1),
  providerRequestId: z.string().min(1).max(256).optional(),
  capturedAt: IsoInstantSchema,
});

export { ProviderRunNodeExecutionIdentitySchema } from "../../models/providers/historical-provider-evidence.js";
export const ProviderExecutionIdentitySchema = ProviderRunNodeExecutionIdentitySchema;
export function isRunNodeExecutionIdentity(identity: z.output<typeof HistoricalProviderExecutionIdentitySchema>): identity is z.output<typeof ProviderRunNodeExecutionIdentitySchema> {
  return "nodeId" in identity;
}

export const ProviderBudgetReservationSchema = z.strictObject({
  requestCount: z.literal(1),
  maximumCostUsdMicros: z.number().int().nonnegative(),
});

export const ProviderAdmissionLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("reserved"),
    reservedAt: IsoInstantSchema,
    leaseExpiresAt: IsoInstantSchema,
    deadlineAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("denied"),
    deniedAt: IsoInstantSchema,
    reason: ProviderUnavailableReasonSchema,
  }),
  z.strictObject({
    state: z.literal("settled"),
    settledAt: IsoInstantSchema,
    adapterDisposition: z.enum(["produced", "unavailable", "invalid-response"]),
    actualUsage: ProviderMeasuredUsageSchema,
    evidence: RedactedProviderEvidenceSchema,
  }),
  z.strictObject({
    state: z.literal("interrupted"),
    interruptedAt: IsoInstantSchema,
    code: z.enum(["aborted", "timeout", "adapter-error", "invalid-outcome", "cost-estimate-breach"]),
    message: z.string().min(1),
    accounting: z.literal("full-reservation-retained"),
    evidence: RedactedProviderEvidenceSchema.optional(),
  }),
  z.strictObject({
    state: z.literal("lease-expired"),
    expiredAt: IsoInstantSchema,
    accounting: z.literal("full-reservation-retained"),
  }),
]);

export const ProviderAdmissionRecordSchema = z.strictObject({
  admissionId: ProviderAdmissionIdSchema,
  execution: HistoricalProviderExecutionIdentitySchema,
  capability: HistoricalProviderCapabilitySchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  configFingerprint: FingerprintSchema,
  requestFingerprint: FingerprintSchema,
  budget: ProviderBudgetSchema,
  estimate: ProviderCostEstimateSchema,
  reservation: ProviderBudgetReservationSchema,
  lifecycle: ProviderAdmissionLifecycleSchema,
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
});

export const ProviderBudgetCounterSchema = z.strictObject({
  capability: HistoricalProviderCapabilitySchema,
  minuteWindowStartedAt: IsoInstantSchema,
  minuteRequests: z.number().int().nonnegative(),
  dayWindowStartedAt: IsoInstantSchema,
  dayRequests: z.number().int().nonnegative(),
  dayReservedCostUsdMicros: z.number().int().nonnegative(),
  activeReservations: z.number().int().nonnegative(),
  blockedByAdmissionId: ProviderAdmissionIdSchema.optional(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
});

const ProviderAdmissionRequestBaseSchema = z.strictObject({
  admissionId: ProviderAdmissionIdSchema,
  execution: ProviderExecutionIdentitySchema,
  capability: ProviderCapabilityIdSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  configFingerprint: FingerprintSchema,
  requestFingerprint: FingerprintSchema,
  estimate: ProviderCostEstimateSchema,
  now: IsoInstantSchema,
});

export const ProviderAdmissionReserveRequestSchema = ProviderAdmissionRequestBaseSchema.extend({
  leaseExpiresAt: IsoInstantSchema,
  deadlineAt: IsoInstantSchema,
}).superRefine((request, context) => {
  const now = Date.parse(request.now);
  if (Date.parse(request.deadlineAt) <= now) {
    context.addIssue({ code: "custom", path: ["deadlineAt"], message: "deadlineAt must be after now" });
  }
  if (Date.parse(request.leaseExpiresAt) < Date.parse(request.deadlineAt)) {
    context.addIssue({ code: "custom", path: ["leaseExpiresAt"], message: "lease cannot expire before deadline" });
  }
});

export const ProviderAdmissionDenyRequestSchema = ProviderAdmissionRequestBaseSchema.extend({
  reason: ProviderUnavailableReasonSchema,
});

export const ProviderAdmissionReserveOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("reserved"),
    admission: ProviderAdmissionRecordSchema,
    counter: ProviderBudgetCounterSchema,
  }),
  z.strictObject({
    state: z.literal("denied"),
    admission: ProviderAdmissionRecordSchema,
    counter: ProviderBudgetCounterSchema,
  }),
  z.strictObject({
    state: z.literal("existing"),
    admission: ProviderAdmissionRecordSchema,
  }),
]);

export const ProviderAdmissionSettleRequestSchema = z.strictObject({
  admissionId: ProviderAdmissionIdSchema,
  expectedVersion: PositiveIntSchema,
  actualUsage: ProviderMeasuredUsageSchema,
  adapterDisposition: z.enum(["produced", "unavailable", "invalid-response"]),
  evidence: RedactedProviderEvidenceSchema,
  now: IsoInstantSchema,
});

export const ProviderAdmissionInterruptRequestSchema = z.strictObject({
  admissionId: ProviderAdmissionIdSchema,
  expectedVersion: PositiveIntSchema,
  code: z.enum(["aborted", "timeout", "adapter-error", "invalid-outcome", "cost-estimate-breach"]),
  message: z.string().min(1),
  evidence: RedactedProviderEvidenceSchema.optional(),
  now: IsoInstantSchema,
});

export const ProviderAdmissionMutationOutcomeSchema = z.strictObject({
  admission: ProviderAdmissionRecordSchema,
  counter: ProviderBudgetCounterSchema,
});

export const ProviderAdmissionSweepRequestSchema = z.strictObject({ now: IsoInstantSchema });
export const ProviderAdmissionSweepOutcomeSchema = z.strictObject({
  expired: z.array(ProviderAdmissionRecordSchema),
  counters: z.array(ProviderBudgetCounterSchema),
});

export type ProviderUnavailableReason = z.output<typeof ProviderUnavailableReasonSchema>;
export type ProviderCostEstimate = z.output<typeof ProviderCostEstimateSchema>;
export type ProviderAdmissionRecord = z.output<typeof ProviderAdmissionRecordSchema>;
export type ProviderBudgetCounter = z.output<typeof ProviderBudgetCounterSchema>;
export type ProviderAdmissionReserveOutcome = z.output<typeof ProviderAdmissionReserveOutcomeSchema>;
export type ProviderAdmissionMutationOutcome = z.output<typeof ProviderAdmissionMutationOutcomeSchema>;
export type ProviderAdmissionSweepOutcome = z.output<typeof ProviderAdmissionSweepOutcomeSchema>;
