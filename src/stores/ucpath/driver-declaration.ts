import { declareDriverFor } from "../../base/store.js";
import type { UcpathStoreDriver } from "../../domain/ui/ucpath-driver.js";

/** Safe typed declaration: no raw browser owner is reachable from task code. */
export const ucpathDriver = declareDriverFor<UcpathStoreDriver>()("ucpath", "semantic-ready");
