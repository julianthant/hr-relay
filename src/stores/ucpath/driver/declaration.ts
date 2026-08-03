import { declareDriverFor } from "../../../base/store.js";
import type { UcpathPersonOrgDriver } from "../../../domain/ui/ucpath-person-org.js";

export const ucpathDriver = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");
