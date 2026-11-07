import type { RunDetailQueryDeps } from "../../../runs/queries/run-detail.js";
import type { DiagnosticBundleQueryDeps } from "../../../runs/queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../../../runs/queries/artifact-bytes.js";

export interface TrustRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
}
