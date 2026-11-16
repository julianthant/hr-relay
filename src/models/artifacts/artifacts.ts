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

export const NamedFileArtifactOutputSchema = z.strictObject({ fileName: NamedArtifactFileNameSchema, artifact: ArtifactRefSchema });
export type NamedFileArtifactOutput = z.infer<typeof NamedFileArtifactOutputSchema>;

export const ArtifactRelativePathSchema = z.string().min(1).max(1024).refine(path =>
  path.split("/").every(segment => NamedArtifactFileNameSchema.safeParse(segment).success), "artifact path must contain safe relative segments");
export const ArtifactCollectionFilesSchema = z.array(z.strictObject({ relativePath: ArtifactRelativePathSchema, artifact: ArtifactRefSchema })).min(1)
  .superRefine((files, ctx) => {
    const paths = new Set(files.map(file => file.relativePath.normalize("NFC").toLowerCase()));
    const directories = new Map<string, string>();
    if (paths.size !== files.length) ctx.addIssue({ code: "custom", message: "collection destinations must be unique" });
    for (const file of files) {
      const segments = file.relativePath.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        const directory = segments.slice(0, index).join("/"), key = directory.normalize("NFC").toLowerCase();
        if (paths.has(key) || directories.has(key) && directories.get(key) !== directory) {
          ctx.addIssue({ code: "custom", message: "collection destinations have conflicting parents" });
        }
        directories.set(key, directory);
      }
    }
  });
export const ARTIFACT_COLLECTION_MEDIA_TYPE = "application/vnd.relay.artifact-collection+json";
export const ArtifactCollectionManifestSchema = z.strictObject({ files: ArtifactCollectionFilesSchema });
export const CollectionArtifactOutputSchema = ArtifactCollectionManifestSchema.extend({
  artifact: ArtifactRefSchema.extend({ mediaType: z.literal(ARTIFACT_COLLECTION_MEDIA_TYPE) }),
});
export type CollectionArtifactOutput = z.infer<typeof CollectionArtifactOutputSchema>;
export const NamedArtifactOutputSchema = z.union([NamedFileArtifactOutputSchema, CollectionArtifactOutputSchema]);
export type NamedArtifactOutput = z.infer<typeof NamedArtifactOutputSchema>;
