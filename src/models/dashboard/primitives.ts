import { z } from "zod";
import { CapabilityAvailabilitySchema } from "../../rules/validation/absence.js";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";

export const DashboardWireVersionSchema = z.literal(1);
export const AppVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).brand<"AppVersion">();
/** The app build a RUN carries, read forward: runs enqueued before the stamp existed carry none, and the surface says so with its reason. */
export const RunAppVersionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: AppVersionSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type RunAppVersion = z.infer<typeof RunAppVersionSchema>;

export const ProjectionGenerationSchema = z.number().int().positive().brand<"ProjectionGeneration">();
export const RevisionSchema = z.number().int().positive().brand<"Revision">();
export const RowRevisionSchema = z.number().int().positive().brand<"RowRevision">();
export const RecordRevisionSchema = z.number().int().positive().brand<"RecordRevision">();

export const PanelKindSchema = z.enum(["run", "member", "review", "group"]);
export const RunDetailSectionSchema = z.enum([
  "logs", "receipt", "review", "people", "context-data", "context-evidence",
  "context-attempts", "failure", "captures", "parked-write", "identity-gate",
]);

export const WireErrorSchema = z.strictObject({
  state: z.literal("error"),
  code: ErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});

export function wireResourceSchema<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), value }),
    z.strictObject({ state: z.literal("missing"), reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("purged"), reason: z.string().min(1) }),
    WireErrorSchema,
  ]);
}

export const FeatureAvailabilityWireSchema = z.strictObject({
  feature: z.enum(["ocr", "archive", "workflow-editor"]),
  availability: CapabilityAvailabilitySchema,
});

export type DashboardWireVersion = z.infer<typeof DashboardWireVersionSchema>;
export type ProjectionGeneration = z.infer<typeof ProjectionGenerationSchema>;
export type RowRevision = z.infer<typeof RowRevisionSchema>;
export type RecordRevision = z.infer<typeof RecordRevisionSchema>;
