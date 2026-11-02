import { deepFreeze } from "../../rules/validation/immutability.js";
import { separationsWorkflow } from "./workflow.js";
import { separationsStore } from "./task-registry.js";
import { separationsKronosTimecardWorkflow } from "./steps/kronos-timecard/step.js";
import { separationsKualiReadWorkflow } from "./steps/kuali-extraction/step.js";
import { separationsIdentityCheckWorkflow } from "./steps/identity-check/step.js";
import { separationsUcpathTerminationWorkflow } from "./steps/ucpath-transaction/step.js";
import { separationsKualiFinalizationWorkflow } from "./steps/kuali-finalization/step.js";

export const registration = deepFreeze({
  definition: separationsWorkflow,
  exposure: { kind: "public", order: 1 },
  store: separationsStore,
  proofs: [
    { definition: separationsKronosTimecardWorkflow, order: 0 },
    { definition: separationsKualiReadWorkflow, order: 1 },
    { definition: separationsIdentityCheckWorkflow, order: 2 },
    { definition: separationsUcpathTerminationWorkflow, order: 3 },
    { definition: separationsKualiFinalizationWorkflow, order: 4 },
  ],
} as const);
