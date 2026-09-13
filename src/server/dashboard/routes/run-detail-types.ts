import type { RunDetailQueryDeps } from "../queries/run-detail.js";
import type { AdvisoryQueryDeps } from "../queries/advisory.js";

export interface RunDetailRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly advisory?: AdvisoryQueryDeps;
}
