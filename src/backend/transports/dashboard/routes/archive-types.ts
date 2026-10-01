import type { DiagnosticBundleQueryDeps } from "../../../../server/dashboard/queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../../../../server/dashboard/queries/artifact-bytes.js";
import type { ArchiveQueryDeps } from "../../../../server/dashboard/queries/archive.js";

export interface ArchiveRouteDeps {
  readonly archive: ArchiveQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
