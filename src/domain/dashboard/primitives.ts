import { z } from "zod";
import { CapabilityAvailabilitySchema } from "../absence.js";
import { ErrorCodeSchema } from "../ids.js";

export const DashboardWireVersionSchema = z.literal(1);
export const AppVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).brand<"AppVersion">();
/**
 * The app build a RUN carries (D179), read forward. Charter §25 stamps the app
 * version on every run at enqueue because it is the other half of the archive
 * key; runs enqueued before that stamp existed carry none, and the surface says
 * so with its reason rather than borrowing the build it is being served by.
 * Serving the CURRENT build here is what made the run-identity "stale app"
 * comparison structurally unable to fire.
 */
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
  "context-attempts", "failure", "captures",
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
  feature: z.enum(["capture", "ocr", "ai-advisory", "archive", "workflow-editor"]),
  availability: CapabilityAvailabilitySchema,
});

export type DashboardWireVersion = z.infer<typeof DashboardWireVersionSchema>;
export type ProjectionGeneration = z.infer<typeof ProjectionGenerationSchema>;
export type RowRevision = z.infer<typeof RowRevisionSchema>;
export type RecordRevision = z.infer<typeof RecordRevisionSchema>;
