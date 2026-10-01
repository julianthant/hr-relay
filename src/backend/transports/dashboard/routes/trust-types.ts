import type { RunDetailQueryDeps } from "../../../../server/dashboard/queries/run-detail.js";
import type { DiagnosticBundleQueryDeps } from "../../../../server/dashboard/queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../../../../server/dashboard/queries/artifact-bytes.js";

export interface TrustRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
