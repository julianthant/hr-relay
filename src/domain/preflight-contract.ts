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

export const RuntimeCapabilitySchema = z.enum([
  "dashboard.serve",
  "executor.run",
  "workflow.kuali-fill",
  "workflow.sharepoint-download",
  "feature.capture",
  "feature.ocr",
  "feature.ai-advisory",
  "system.ucpath.prod", "system.ucpath.test",
  "system.crm.prod", "system.crm.test",
  "system.onbase.prod", "system.onbase.test",
  "system.kuali.prod", "system.kuali.test",
  "system.servicenow.prod", "system.servicenow.test",
  "system.i9.prod", "system.i9.test",
  "system.new-kronos.prod", "system.new-kronos.test",
  "system.old-kronos.prod", "system.old-kronos.test",
  "system.sharepoint.prod", "system.sharepoint.test",
  "provider.gemini", "provider.groq", "provider.mistral", "provider.openrouter", "provider.sambanova",
  "provider.census", "provider.nominatim",
]);

export const PreflightCheckIdSchema = z.string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .brand<"PreflightCheckId">();

export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>;
export type PreflightCheckId = z.infer<typeof PreflightCheckIdSchema>;

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
