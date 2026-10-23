import { z } from "zod";
import { FingerprintSchema, TaskIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

export const BUILD_MANIFEST_PATH = "src/workflow-kit/validation/generated-build-manifest.ts";

export const SourceHashSchema = z.strictObject({
  /** Repo-relative, POSIX-separated. Absolute paths would make the hash machine-specific. */
  path: z.string().regex(/^[A-Za-z0-9._/-]+$/, "source path must be repo-relative and POSIX-separated"),
  sha256: FingerprintSchema,
});
export type SourceHash = z.infer<typeof SourceHashSchema>;

const BuildManifestEntrySchema = z.strictObject({
  fingerprint: FingerprintSchema,
  /** The exact closure that produced the fingerprint, sorted by path. */
  sources: z.array(SourceHashSchema).min(1),
});

export const BuildManifestSchema = z.strictObject({
  kind: z.literal("hrauto-rebuild-build-manifest"),
  manifestVersion: z.literal(1),
  toolchain: z.strictObject({
    typescript: z.string().min(1),
    zod: z.string().min(1),
  }),
  workflows: z.array(z.strictObject({
    ...BuildManifestEntrySchema.shape,
    id: WorkflowIdSchema,
  })),
  tasks: z.array(z.strictObject({
    ...BuildManifestEntrySchema.shape,
    id: TaskIdSchema,
  })),
});
export type BuildManifest = z.infer<typeof BuildManifestSchema>;

export function parseBuildManifest(input: unknown): BuildManifest {
  const manifest = BuildManifestSchema.parse(input);
  const workflowIds: readonly string[] = manifest.workflows.map(({ id }) => id);
  if (new Set(workflowIds).size !== workflowIds.length) {
    throw new Error("build manifest repeats a workflow id");
  }
  const taskIds: readonly string[] = manifest.tasks.map(({ id }) => id);
  if (new Set(taskIds).size !== taskIds.length) {
    throw new Error("build manifest repeats a task id");
  }
  return manifest;
}
