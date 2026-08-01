import { z } from "zod";
import { ArtifactIdSchema, FingerprintSchema } from "./ids.js";

export const ArtifactRefSchema = z.strictObject({
  id: ArtifactIdSchema,
  sha256: FingerprintSchema,
  bytes: z.number().int().nonnegative(),
  mediaType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
});

export const ArtifactPutMetadataSchema = z.strictObject({
  mediaType: ArtifactRefSchema.shape.mediaType,
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type ArtifactPutMetadata = z.infer<typeof ArtifactPutMetadataSchema>;
