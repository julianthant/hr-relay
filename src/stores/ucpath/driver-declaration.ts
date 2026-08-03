import { declareDriverFor } from "../../base/store.js";
import type { UcpathPersonOrgDriver } from "../../domain/ui/ucpath-person-org.js";

/** Safe typed declaration: no raw browser owner is reachable from task code. */
export const ucpathDriver = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");
