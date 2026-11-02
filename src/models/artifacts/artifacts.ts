import { z } from "zod";
import { ArtifactIdSchema, FingerprintSchema } from "../../rules/identity/ids.js";

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

export const NamedArtifactFileNameSchema = z.string().min(1).max(200)
  .regex(/^[^<>:"/\\|?*]+$/u)
  .refine(name => [...name].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && name === name.trim() && !name.startsWith(".") && !name.endsWith(".")
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
    && new TextEncoder().encode(name).length <= 200, "output filename must be one safe filename");

export const NamedArtifactOutputSchema = z.strictObject({ fileName: NamedArtifactFileNameSchema, artifact: ArtifactRefSchema });
export type NamedArtifactOutput = z.infer<typeof NamedArtifactOutputSchema>;
