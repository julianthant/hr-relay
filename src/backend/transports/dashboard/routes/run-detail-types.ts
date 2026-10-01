import type { RunDetailQueryDeps } from "../../../../server/dashboard/queries/run-detail.js";
import type { AdvisoryQueryDeps } from "../../../../server/dashboard/queries/advisory.js";

export interface RunDetailRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly advisory?: AdvisoryQueryDeps;
}
