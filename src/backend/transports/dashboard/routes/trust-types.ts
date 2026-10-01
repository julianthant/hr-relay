import type { RunDetailQueryDeps } from "../../../runs/dashboard/queries/run-detail.js";
import type { DiagnosticBundleQueryDeps } from "../../../runs/dashboard/queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../../../runs/dashboard/queries/artifact-bytes.js";

export interface TrustRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
