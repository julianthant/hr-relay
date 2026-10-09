import { HistoricalProviderCapabilitySchema, HistoricalProviderExecutionIdentitySchema } from "../../models/providers/historical-provider-evidence.js";
import { z } from "zod";
import { ProviderAdmissionRecordSchema, ProviderBudgetCounterSchema } from "./provider-admission.js";
import { FingerprintSchema, IsoInstantSchema, PositiveIntSchema, ConfigSnapshotIdSchema } from "../identity/ids.js";
const ReferenceSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/);
export const ProviderAttributionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("legacy-capability"), capability: HistoricalProviderCapabilitySchema }),
  z.strictObject({ kind: z.literal("unattributed"), reason: z.enum(["not-supplied", "historical-unknown"]) }),
  z.strictObject({ kind: z.literal("attributed"), provider: ReferenceSchema,
    credential: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("keyless") }), z.strictObject({ kind: z.literal("generation"), reference: ReferenceSchema })]),
    model: ReferenceSchema.optional() }),
]);
export const ProviderScopeSchema = z.strictObject({
  id: ReferenceSchema,
  kind: z.enum(["legacy-capability", "application-budget", "credential", "provider-model", "shared-quota"]),
});
export const ProviderMeterSchema = z.enum(["requests", "input-tokens", "output-tokens", "usd-micros"]);
export const ProviderQuantitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("measured"), value: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("estimated"), value: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("unknown"), retainedUpperBound: z.number().int().nonnegative().nullable() }),
]);
export const ProviderAllocationSchema = z.strictObject({
  scopeId: ReferenceSchema, meter: ProviderMeterSchema, windowId: ReferenceSchema,
  windowStartedAt: IsoInstantSchema, windowEndsAt: IsoInstantSchema.nullable(),
  upperBound: z.number().int().nonnegative(), trackingOrigin: z.enum(["pre-tracking", "tracked"]),
});
const TrackingSchema = z.strictObject({ startedAt: IsoInstantSchema, coverage: z.enum(["complete-since-start", "historical-gaps"]),
  evidence: z.enum(["legacy-reported", "caller-supplied"]),
});
export const GenericProviderRequestSchema = z.strictObject({
  format: z.literal(1), kind: z.literal("generic"), requestId: z.uuid(), execution: HistoricalProviderExecutionIdentitySchema,
  capability: HistoricalProviderCapabilitySchema, configSnapshotId: ConfigSnapshotIdSchema, configFingerprint: FingerprintSchema,
  requestFingerprint: FingerprintSchema, attribution: ProviderAttributionSchema,
  allocations: z.array(ProviderAllocationSchema).max(128),
  state: z.enum(["reserved", "denied", "settled", "interrupted", "lease-expired"]),
  usage: z.array(z.strictObject({ meter: ProviderMeterSchema, quantity: ProviderQuantitySchema })).max(4),
  leaseExpiresAt: IsoInstantSchema.nullable(), deadlineAt: IsoInstantSchema.nullable(),
  reason: z.string().min(1).max(512).nullable(), version: PositiveIntSchema, createdAt: IsoInstantSchema, updatedAt: IsoInstantSchema,
}).superRefine((r, ctx) => {
  const keys = r.allocations.map((a) => `${a.scopeId}\0${a.meter}\0${a.windowId}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "duplicate provider allocation" });
  if(new Set(r.usage.map(u=>u.meter)).size!==r.usage.length)ctx.addIssue({code:"custom",message:"duplicate provider usage meter"});
  if(Date.parse(r.updatedAt)<Date.parse(r.createdAt))ctx.addIssue({code:"custom",message:"provider request time moved backwards"});
  if(r.state!=="reserved"&&(r.leaseExpiresAt!==null||r.deadlineAt!==null))ctx.addIssue({code:"custom",message:"settled provider request cannot retain an active lease"});
  if(r.allocations.some(a=>a.windowEndsAt!==null&&Date.parse(a.windowEndsAt)<=Date.parse(a.windowStartedAt)))ctx.addIssue({code:"custom",message:"provider allocation window invalid"});
  if (r.state === "denied" && r.allocations.length !== 0) ctx.addIssue({ code: "custom", message: "denied provider request allocates nothing" });
  if (r.state === "reserved" && (r.leaseExpiresAt === null || r.deadlineAt === null)) ctx.addIssue({ code: "custom", message: "reserved provider request requires deadline and lease" });
});
export const GenericProviderUsageSchema = z.strictObject({
  format: z.literal(1), kind: z.literal("generic"), usageId: ReferenceSchema, scope: ProviderScopeSchema,
  meter: ProviderMeterSchema, tracking: TrackingSchema, cumulative: ProviderQuantitySchema,
  windows: z.array(z.strictObject({ id: ReferenceSchema, startsAt: IsoInstantSchema, endsAt: IsoInstantSchema.nullable(),
    settled: ProviderQuantitySchema, retainedUnknown: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(),
    limit: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("unknown") }), z.strictObject({ kind: z.literal("configured"), value: z.number().int().nonnegative(), provenance: ReferenceSchema })]),
  })).max(10000), version: PositiveIntSchema, createdAt: IsoInstantSchema, updatedAt: IsoInstantSchema,
});
export const LegacyProviderRequestSchema = z.strictObject({
  format: z.literal(1), kind: z.literal("legacy-capability"), origin: z.enum(["pre-tracking", "tracked"]), record: ProviderAdmissionRecordSchema,
  attribution: ProviderAttributionSchema.options[0], tracking: TrackingSchema,
}).superRefine((r, c) => { if (r.attribution.capability !== r.record.capability) c.addIssue({ code: "custom", message: "legacy capability attribution mismatch" }); });
export const LegacyProviderUsageSchema = z.strictObject({
  format: z.literal(1), kind: z.literal("legacy-capability"), record: ProviderBudgetCounterSchema,
  tracking: TrackingSchema,
  cumulative: z.strictObject({ requests: z.number().int().nonnegative(), chargedUsdMicros: z.number().int().nonnegative() }),
});
export const ProviderRequestStorageSchema = z.discriminatedUnion("kind", [LegacyProviderRequestSchema, GenericProviderRequestSchema]);
export const ProviderUsageStorageSchema = z.discriminatedUnion("kind", [LegacyProviderUsageSchema, GenericProviderUsageSchema]);
export type ProviderRequestStorage = z.infer<typeof ProviderRequestStorageSchema>;
export type ProviderUsageStorage = z.infer<typeof ProviderUsageStorageSchema>;
