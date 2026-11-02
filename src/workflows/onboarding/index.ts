import { deepFreeze } from "../../rules/validation/immutability.js";
import { onboardingWorkflow } from "./workflow.js";
import { onboardingStore } from "./task-registry.js";
import { onboardingCrmDataWorkflow } from "./steps/crm-data/step.js";
import { onboardingUcpathSearchWorkflow } from "./steps/ucpath-search/step.js";
import { onboardingI9SearchWorkflow } from "./steps/i9-search/step.js";
import { onboardingI9ProfileCreationWorkflow } from "./steps/i9-profile-creation/step.js";

export const registration = deepFreeze({
  definition: onboardingWorkflow, exposure: { kind: "unregistered" }, store: onboardingStore,
  proofs: [
    { definition: onboardingCrmDataWorkflow, order: 0 },
    { definition: onboardingUcpathSearchWorkflow, order: 1 },
    { definition: onboardingI9SearchWorkflow, order: 2 },
    { definition: onboardingI9ProfileCreationWorkflow, order: 3 },
  ],
} as const);
