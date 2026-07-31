import { z } from "zod";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  DiagnosticBundleIdSchema,
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  RunIdSchema,
} from "../ids.js";
import { RedactionResultSchema } from "../redaction.js";

export const DiagnosticAttachmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("screenshot"),
    artifactId: ArtifactIdSchema,
    mediaType: z.enum(["image/png", "image/jpeg"]),
    byteLength: z.number().int().nonnegative(),
    digest: FingerprintSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sensitivity: z.enum(["redacted", "restricted"]),
  }),
  z.strictObject({
    kind: z.literal("accessibility-excerpt"),
    artifactId: ArtifactIdSchema,
    mediaType: z.literal("text/yaml"),
    byteLength: z.number().int().nonnegative(),
    digest: FingerprintSchema,
    sensitivity: z.literal("redacted"),
  }),
  z.strictObject({
    kind: z.enum(["network-summary", "console-summary"]),
    artifactId: ArtifactIdSchema,
    mediaType: z.literal("application/json"),
    byteLength: z.number().int().nonnegative(),
    digest: FingerprintSchema,
    sensitivity: z.literal("redacted"),
  }),
]);

const DiagnosticOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("failure"), failureId: FailureIdSchema }),
  z.strictObject({ kind: z.literal("unexpected-state"), failureId: FailureIdSchema }),
  z.strictObject({ kind: z.literal("subject-mismatch"), failureId: FailureIdSchema }),
  z.strictObject({ kind: z.literal("recovery-park"), failureId: FailureIdSchema }),
  z.strictObject({ kind: z.literal("operator-request"), requestedBy: ActorIdSchema }),
]);

export const DiagnosticBundleSchema = z.strictObject({
  bundleId: DiagnosticBundleIdSchema,
  runId: RunIdSchema,
  origin: DiagnosticOriginSchema,
  createdAt: IsoInstantSchema,
  contentDigest: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  descriptorFingerprint: FingerprintSchema,
  redaction: RedactionResultSchema,
  attachments: z.array(DiagnosticAttachmentSchema).max(20),
  retention: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ordinary"), purgeAfter: IsoInstantSchema }),
    z.strictObject({ kind: z.literal("pinned"), reason: z.enum(["knowledge", "fix", "write-recovery"]) }),
  ]),
}).superRefine((bundle, context) => {
  const artifactIds = bundle.attachments.map(({ artifactId }) => artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({ code: "custom", path: ["attachments"], message: "diagnostic attachment artifact ids must be unique" });
  }
});

export type DiagnosticBundle = z.infer<typeof DiagnosticBundleSchema>;
