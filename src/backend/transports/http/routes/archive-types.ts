import type { DiagnosticBundleQueryDeps } from "../../../runs/queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../../../runs/queries/artifact-bytes.js";
import type { ArchiveQueryDeps } from "../../../runs/queries/archive.js";

export interface ArchiveRouteDeps {
  readonly archive: ArchiveQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
