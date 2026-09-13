import type { RunDetailQueryDeps } from "../queries/run-detail.js";
import type { DiagnosticBundleQueryDeps } from "../queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../queries/artifact-bytes.js";

export interface TrustRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
