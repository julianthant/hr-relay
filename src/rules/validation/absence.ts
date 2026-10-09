import { z } from "zod";

export const AbsenceCodeSchema = z.enum([
  "not-provided",
  "not-observed",
  "not-applicable",
  "not-configured",
  "not-supported",
  "purged",
]);

export function explicitValueSchema<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value }),
    z.strictObject({ state: z.literal("absent"), code: AbsenceCodeSchema, reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("unknown"), reason: z.string().min(1) }),
    z.strictObject({
      state: z.literal("ambiguous"),
      reason: z.string().min(1),
      candidates: z.array(value).min(2),
    }),
  ]);
}

export const CapabilityAvailabilitySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available") }),
  z.strictObject({
    state: z.literal("unavailable"),
    code: z.enum(["not-configured", "not-supported", "preflight-failed", "deferred"]),
    reason: z.string().min(1),
  }),
]);

export type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;
