import { z } from "zod";
import {
  ActorIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  SourceSurfaceIdSchema,
} from "./ids.js";
import { PreflightCheckIdSchema } from "./preflight-check.js";
import { RuntimeCapabilitySchema } from "./runtime-capability.js";

export const PreflightRerunCommandRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  requestedAt: IsoInstantSchema,
  requestedBy: ActorIdSchema,
  source: SourceSurfaceIdSchema,
  type: z.literal("rerun-preflight"),
  target: z.strictObject({ expectedConfigFingerprint: FingerprintSchema }),
});

export const PreflightResultWireSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pass"), check: PreflightCheckIdSchema, summary: z.string().min(1) }),
  z.strictObject({
    status: z.literal("warning"),
    check: PreflightCheckIdSchema,
    summary: z.string().min(1),
    impact: z.string().min(1),
    remediation: z.string().min(1),
  }),
  z.strictObject({
    status: z.literal("fail"),
    check: PreflightCheckIdSchema,
    summary: z.string().min(1),
    blocks: z.array(RuntimeCapabilitySchema).min(1),
    remediation: z.string().min(1),
  }),
]);

export const PreflightReportWireSchema = z.strictObject({
  configFingerprint: FingerprintSchema,
  descriptorFingerprint: FingerprintSchema.optional(),
  checkedAt: IsoInstantSchema,
  requestedCapabilities: z.array(RuntimeCapabilitySchema).min(1),
  results: z.array(PreflightResultWireSchema).min(1),
});

export const PreflightRerunCommandResultWireSchema = z.strictObject({
  state: z.literal("completed"),
  commandId: CommandIdSchema,
  report: PreflightReportWireSchema,
});
