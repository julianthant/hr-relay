/**
 * The build manifest behind `descriptor.contractFingerprint` (ref workflow-model §1.1).
 *
 * **Fingerprints are build-manifest based, never `Function.toString()`.** A
 * descriptor's fingerprint hashes canonical `(relative path, file content)`
 * tuples over the descriptor source and its bundle-safe transitive dependency
 * closure, plus the locked toolchain versions. Absolute paths, mtimes, build
 * timestamps, and object iteration order are excluded, so identical source in
 * another checkout produces the same hash — while a `bind`/`identity`/`derive`
 * edit changes semantic compatibility even when the output zod schema does not.
 *
 * `src/domain/workflow/generated-build-manifest.ts` is the checked-in artifact;
 * `scripts/generate-build-manifest.ts` regenerates it and the
 * `descriptor-coverage` guard fails on any diff. The generated module is itself
 * excluded from every closure — a manifest that hashed its own contents could
 * never reach a fixed point.
 */
import { z } from "zod";
import { FingerprintSchema, TaskIdSchema, WorkflowIdSchema } from "../ids.js";
import type { Fingerprint, TaskId, WorkflowId } from "../ids.js";
import { GENERATED_BUILD_MANIFEST } from "./generated-build-manifest.js";

export const BUILD_MANIFEST_PATH = "src/domain/workflow/generated-build-manifest.ts";

export const SourceHashSchema = z.strictObject({
  /** Repo-relative, POSIX-separated. Absolute paths would make the hash machine-specific. */
  path: z.string().regex(/^[A-Za-z0-9._/-]+$/, "source path must be repo-relative and POSIX-separated"),
  sha256: FingerprintSchema,
});
export type SourceHash = z.infer<typeof SourceHashSchema>;

export const BuildManifestEntrySchema = z.strictObject({
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

/**
 * Fail loud on a missing entry. A descriptor with no manifest row is a
 * descriptor whose semantic identity nothing pins — a run stamped with a
 * fabricated fingerprint would let an incompatible checkpoint replay.
 */
/** The checked-in manifest, parsed at module load so a hand-edit fails immediately. */
export const BUILD_MANIFEST: BuildManifest = parseBuildManifest(GENERATED_BUILD_MANIFEST);

export function resolveWorkflowFingerprint(manifest: BuildManifest, id: WorkflowId): Fingerprint {
  const entry = manifest.workflows.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new Error(
      `workflow ${id} has no build-manifest entry — regenerate ${BUILD_MANIFEST_PATH} before registering it`,
    );
  }
  return entry.fingerprint;
}

export function resolveTaskImplFingerprint(manifest: BuildManifest, id: TaskId): Fingerprint {
  const entry = manifest.tasks.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new Error(
      `task ${id} has no build-manifest entry — regenerate ${BUILD_MANIFEST_PATH} before binding it`,
    );
  }
  return entry.fingerprint;
}
