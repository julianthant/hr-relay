import { z } from "zod";
import { ActorIdSchema, FailureIdSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema } from "../ids.js";
export const FailureResolutionSchema = z.discriminatedUnion("status", [
 z.strictObject({ status: z.literal("unresolved"), version: PositiveIntSchema }),
 z.strictObject({ status: z.literal("resolved"), version: PositiveIntSchema, by: ActorIdSchema,
  at: IsoInstantSchema, note: z.string().trim().min(1).max(1000).optional() }),
]);
export const FailureResolutionTargetSchema = z.strictObject({ runId: RunIdSchema, failureId: FailureIdSchema, expectedVersion: PositiveIntSchema });
export const FailureResolutionActionSchema = z.discriminatedUnion("action", [
 z.strictObject({ action: z.literal("resolve"), note: z.string().trim().min(1).max(1000).optional() }),
 z.strictObject({ action: z.literal("reopen") }),
]);
export const FailureResolutionCaptureSchema = z.strictObject({ failureId: FailureIdSchema, runId: RunIdSchema, resolution: FailureResolutionSchema });
export const FailureResolutionCapabilitySchema = z.discriminatedUnion("state", [
 z.strictObject({state:z.literal("unavailable"),reason:z.literal("resolution-not-implemented")}),
 z.strictObject({state:z.literal("available")}),
]);
export type FailureResolution = z.infer<typeof FailureResolutionSchema>;
export type FailureResolutionCapture = z.infer<typeof FailureResolutionCaptureSchema>;
