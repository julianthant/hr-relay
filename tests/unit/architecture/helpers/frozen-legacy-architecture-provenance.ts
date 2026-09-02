import { z } from "zod";
import rawProvenance from "../../../../config/ports/legacy-architecture-provenance.json" with { type: "json" };

const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/u, "legacy commit must be an exact SHA-1 commit id");
const BlobSchema = z.string().regex(/^[0-9a-f]{40}$/u, "legacy blob must be an exact SHA-1 object id");
const FrozenFileSchema = z.strictObject({
  path: z.string().min(1),
  blob: BlobSchema,
  text: z.string(),
});

const FrozenFilesSchema = z.array(FrozenFileSchema).min(1).superRefine((files, context) => {
  const paths = files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", message: "frozen legacy file paths must be unique" });
  }
});

const FrozenPathInventorySchema = z.array(z.string().min(1)).min(1).superRefine((paths, context) => {
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", message: "frozen legacy path inventory must be unique" });
  }
});

export const FrozenLegacyArchitectureProvenanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  selector: z.strictObject({
    commit: CommitSchema,
    objectFormat: z.literal("sha1"),
    files: FrozenFilesSchema,
  }),
  runtime: z.strictObject({
    commit: CommitSchema,
    browserSystemFiles: FrozenPathInventorySchema,
    visionProvider: FrozenFileSchema,
  }),
  capabilities: z.strictObject({
    commit: CommitSchema,
    discoveredPaths: FrozenPathInventorySchema,
    sourcePaths: FrozenPathInventorySchema,
    legacyPaths: FrozenPathInventorySchema,
  }),
  testDisposition: z.strictObject({
    baselineCommit: CommitSchema,
    baselineFiles: FrozenPathInventorySchema,
    currentCommit: CommitSchema,
    currentFiles: FrozenPathInventorySchema,
  }),
  canonicalFields: z.strictObject({
    commit: CommitSchema,
    files: FrozenFilesSchema,
  }),
  operationalIsolation: z.strictObject({
    commit: CommitSchema,
    package: z.strictObject({
      path: z.literal("package.json"),
      blob: BlobSchema,
      scripts: z.record(z.string(), z.string()),
    }),
  }),
});

export const FROZEN_LEGACY_ARCHITECTURE_PROVENANCE = FrozenLegacyArchitectureProvenanceSchema.parse(rawProvenance);

export type FrozenLegacyFile = z.infer<typeof FrozenFileSchema>;

/**
 * The legacy checkout is a porting input, never a finished-gate dependency.
 * A missing source is a corrupt committed snapshot, not permission to skip it.
 */
export function frozenLegacyFile(files: readonly FrozenLegacyFile[], path: string): FrozenLegacyFile {
  const matches = files.filter((file) => file.path === path);
  if (matches.length !== 1) {
    throw new Error(`frozen legacy provenance requires exactly one ${path}; found ${String(matches.length)}`);
  }
  return matches[0] as FrozenLegacyFile;
}
