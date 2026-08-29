/**
 * Browser-safe names shared by preflight registry metadata, command results,
 * and dashboard wire schemas. The executable registry deliberately lives in
 * `runtime-dependencies.ts`; importing an id must not import its server-only
 * environment, secret, or filesystem inspectors.
 */
import { z } from "zod";
import {
  ActorIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  SourceSurfaceIdSchema,
} from "./ids.js";
import {
  PreflightCheckIdSchema,
  RuntimeCapabilitySchema,
  validatePreflightReportSemantics,
} from "./preflight-semantics.js";

export {
  PreflightCheckIdSchema,
  RuntimeCapabilitySchema,
  type PreflightCheckId,
  type RuntimeCapability,
} from "./preflight-semantics.js";

/** The closed, browser-safe result shape; registry semantics remain server-side. */
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

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return [...new Set(values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  }))];
}

/**
 * The browser receives the exact report bytes but cannot compose the runtime
 * registry that gives those bytes their semantic authority. Keep structural
 * strictness here and layer registry validation in `preflight.ts` on the server.
 */
export const PreflightReportWireSchema = z.strictObject({
  configFingerprint: FingerprintSchema,
  descriptorFingerprint: FingerprintSchema.optional(),
  checkedAt: IsoInstantSchema,
  requestedCapabilities: z.array(RuntimeCapabilitySchema).min(1),
  results: z.array(PreflightResultWireSchema).min(1),
}).superRefine((report, context) => {
  const duplicateCapabilities = duplicateValues(report.requestedCapabilities);
  if (duplicateCapabilities.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["requestedCapabilities"],
      message: `requested capabilities contain duplicates: ${duplicateCapabilities.join(", ")}`,
    });
  }
  const duplicateResults = duplicateValues(report.results.map(({ check }) => check));
  if (duplicateResults.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["results"],
      message: `preflight results contain duplicate check ids: ${duplicateResults.join(", ")}`,
    });
  }
  validatePreflightReportSemantics(report, context);
});

export const PreflightRerunCommandRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  requestedAt: IsoInstantSchema,
  requestedBy: ActorIdSchema,
  source: SourceSurfaceIdSchema,
  type: z.literal("rerun-preflight"),
  target: z.strictObject({
    expectedConfigFingerprint: FingerprintSchema,
    expectedDescriptorFingerprint: FingerprintSchema.optional(),
  }),
});

/** Keep the server's semantic result and browser wire result on one strict envelope factory. */
export function createPreflightRerunCommandResultSchema<ReportSchema extends z.ZodType>(report: ReportSchema) {
  return z.strictObject({
    state: z.literal("completed"),
    commandId: CommandIdSchema,
    report,
  });
}

export const PreflightRerunCommandResultWireSchema = createPreflightRerunCommandResultSchema(PreflightReportWireSchema);
