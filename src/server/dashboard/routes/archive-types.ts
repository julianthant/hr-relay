import type { DiagnosticBundleQueryDeps } from "../queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../queries/artifact-bytes.js";
import type { ArchiveQueryDeps } from "../queries/archive.js";

export interface ArchiveRouteDeps {
  readonly archive: ArchiveQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
