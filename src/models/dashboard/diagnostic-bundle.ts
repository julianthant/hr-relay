/** The browser-safe read model for one diagnostic bundle: the exact stored attachment identities and capture-time redaction facts, without the durable row's provenance. */
import { z } from "zod";
import {
  ArtifactIdSchema,
  DiagnosticBundleIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
} from "../../rules/identity/ids.js";
import { RedactionResultSchema } from "../../rules/redaction/redaction.js";

export const DiagnosticBundleContentWireSchema = z.strictObject({
  kind: z.enum(["screenshot", "accessibility-excerpt", "network-summary", "console-summary"]),
  key: z.string().min(1),
  detail: z.string().min(1),
  artifactId: ArtifactIdSchema,
  mediaType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  digest: FingerprintSchema,
  sensitivity: z.enum(["redacted", "restricted"]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
}).superRefine((content, context) => {
  const hasAnyDimensions = content.width !== undefined || content.height !== undefined;
  if ((content.kind === "screenshot" && (content.width === undefined || content.height === undefined))
    || (content.kind !== "screenshot" && hasAnyDimensions)) {
    context.addIssue({
      code: "custom",
      path: ["width"],
      message: "only a screenshot carries both captured pixel dimensions",
    });
  }
  if (content.kind !== "screenshot" && content.sensitivity !== "redacted") {
    context.addIssue({
      code: "custom",
      path: ["sensitivity"],
      message: "only a screenshot may remain restricted in a diagnostic bundle",
    });
  }
});

export const DiagnosticBundleWireSchema = z.strictObject({
  bundleId: DiagnosticBundleIdSchema,
  capturedAt: IsoInstantSchema,
  /** Sum of the attachment byte lengths recorded by the durable bundle. */
  byteSize: z.number().int().nonnegative(),
  /** The content address, re-derived before this response is served. */
  contentDigest: FingerprintSchema,
  redaction: RedactionResultSchema,
  contents: z.array(DiagnosticBundleContentWireSchema).max(20),
});

export type DiagnosticBundleWire = z.infer<typeof DiagnosticBundleWireSchema>;
