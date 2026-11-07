import { declareDriverFor } from "../../../workflow-kit/task-registry.js";
import type { UcpathStoreDriver } from "../../../models/ui/ucpath-driver.js";

/** Safe typed declaration: no raw browser owner is reachable from task code. */
export const ucpathDriver = declareDriverFor<UcpathStoreDriver>()("ucpath", "semantic-ready");
