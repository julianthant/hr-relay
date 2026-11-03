import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { onboardingWorkflow } from "./workflow.js";
import { onboardingStore } from "./task-registry.js";
import { onboardingCrmDataDefinition } from "./steps/crm-data/step.js";
import { onboardingUcpathSearchDefinition } from "./steps/ucpath-search/step.js";
import { onboardingI9SearchDefinition } from "./steps/i9-search/step.js";
import { onboardingI9ProfileCreationDefinition } from "./steps/i9-profile-creation/step.js";

export const registration = deepFreeze({
  definition: onboardingWorkflow, exposure: { kind: "public", order: 2 }, store: onboardingStore,
  proofs: [
    defineStepProof(onboardingWorkflow, onboardingCrmDataDefinition),
    defineStepProof(onboardingWorkflow, onboardingUcpathSearchDefinition),
    defineStepProof(onboardingWorkflow, onboardingI9SearchDefinition),
    defineStepProof(onboardingWorkflow, onboardingI9ProfileCreationDefinition),
  ],
} as const);
