import type { DiagnosticBundleQueryDeps } from "../../../runs/dashboard/queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../../../runs/dashboard/queries/artifact-bytes.js";
import type { ArchiveQueryDeps } from "../../../runs/dashboard/queries/archive.js";

export interface ArchiveRouteDeps {
  readonly archive: ArchiveQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
