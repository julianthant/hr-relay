import { z } from "zod";

export const NativePathFieldSchema = z.enum([
  "paths.stateRoot",
  "paths.artifactRoot",
  "paths.browserProfileRoot",
  "paths.duoExtensionDir",
  "paths.reportsDir",
  "paths.downloadsDir",
  "paths.onboardingDocsDir",
  "paths.i9CheckTrackerPath",
]);

export const NativePathPickerRequestSchema = z.strictObject({
  field: NativePathFieldSchema,
  initialPath: z.string().min(1).max(4096).optional(),
});

export const NativePathPickerResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("selected"), field: NativePathFieldSchema, path: z.string().min(1) }),
  z.strictObject({ state: z.literal("cancelled"), field: NativePathFieldSchema }),
  z.strictObject({ state: z.literal("unavailable"), field: NativePathFieldSchema,
    reason: z.enum(["unsupported-platform", "busy", "timeout", "dialog-failed"]) }),
]);

export type NativePathField = z.infer<typeof NativePathFieldSchema>;
export type NativePathPickerRequest = z.infer<typeof NativePathPickerRequestSchema>;
export type NativePathPickerResponse = z.infer<typeof NativePathPickerResponseSchema>;
