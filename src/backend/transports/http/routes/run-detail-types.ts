import type { RunDetailQueryDeps } from "../../../runs/queries/run-detail.js";
import type { AdvisoryQueryDeps } from "../../../runs/queries/advisory.js";

export interface RunDetailRouteDeps {
  readonly runDetail: RunDetailQueryDeps;
  readonly advisory?: AdvisoryQueryDeps;
}
