import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { separationsIdentityCheckDefinition } from "./steps/identity-check/step.js";
import { separationsKronosTimecardDefinition } from "./steps/kronos-timecard/step.js";
import { separationsKualiReadDefinition } from "./steps/kuali-extraction/step.js";
import { separationsKualiFinalizationDefinition } from "./steps/kuali-finalization/step.js";
import { separationsUcpathTerminationDefinition } from "./steps/ucpath-transaction/step.js";
import { separationsStore } from "./task-registry.js";
import { separationsWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: separationsWorkflow,
  exposure: { kind: "public", order: 1 },
  store: separationsStore,
  proofs: [
    defineStepProof(separationsWorkflow, separationsKronosTimecardDefinition),
    defineStepProof(separationsWorkflow, separationsKualiReadDefinition),
    defineStepProof(separationsWorkflow, separationsIdentityCheckDefinition),
    defineStepProof(separationsWorkflow, separationsUcpathTerminationDefinition),
    defineStepProof(separationsWorkflow, separationsKualiFinalizationDefinition),
  ],
} as const);
