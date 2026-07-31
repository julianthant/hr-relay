import { z } from "zod";
import { ArtifactIdSchema, FingerprintSchema } from "../ids.js";
import { WireErrorSchema } from "./primitives.js";

const ArtifactBaseSchema = z.strictObject({
  artifactId: ArtifactIdSchema,
  sha256: FingerprintSchema,
  byteLength: z.number().int().nonnegative(),
  sensitivity: z.enum(["safe", "redacted", "restricted"]),
  redaction: z.enum(["not-required", "applied", "restricted-access"]),
});

export const ArtifactRefWireSchema = z.discriminatedUnion("mediaKind", [
  ArtifactBaseSchema.extend({
    mediaKind: z.literal("image"),
    mediaType: z.enum(["image/png", "image/jpeg"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  ArtifactBaseSchema.extend({
    mediaKind: z.literal("pdf"),
    mediaType: z.literal("application/pdf"),
    pageCount: z.number().int().positive(),
  }),
  ArtifactBaseSchema.extend({
    mediaKind: z.literal("data"),
    mediaType: z.enum(["application/json", "text/plain", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  }),
]);

export const CapturePointerWireSchema = z.strictObject({
  artifactId: ArtifactIdSchema,
  dimensions: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), width: z.number().int().positive(), height: z.number().int().positive() }),
    z.strictObject({ state: z.literal("missing"), reason: z.string().min(1) }),
  ]),
});

export const ArtifactResourceWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), value: ArtifactRefWireSchema }),
  z.strictObject({ state: z.literal("missing"), artifactId: ArtifactIdSchema, reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("purged"), artifactId: ArtifactIdSchema, reason: z.string().min(1) }),
  WireErrorSchema.extend({ artifactId: ArtifactIdSchema }),
]);

export type ArtifactRefWire = z.infer<typeof ArtifactRefWireSchema>;
