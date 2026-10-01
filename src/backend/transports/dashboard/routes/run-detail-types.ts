import type { RunDetailQueryDeps } from "../../../runs/dashboard/queries/run-detail.js";
import type { AdvisoryQueryDeps } from "../../../runs/dashboard/queries/advisory.js";

export interface RunDetailRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly advisory?: AdvisoryQueryDeps;
}
