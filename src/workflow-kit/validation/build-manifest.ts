/** The build manifest behind `descriptor.contractFingerprint`; fingerprints hash canonical (path, content) tuples over the descriptor's closure plus toolchain — never `Function.toString()`. */
import { BUILD_MANIFEST_PATH, parseBuildManifest, type BuildManifest } from "../../models/workflow/build-manifest.js";
import type { Fingerprint, TaskId, WorkflowId } from "../../rules/identity/ids.js";
import { GENERATED_BUILD_MANIFEST } from "./generated-build-manifest.js";

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
