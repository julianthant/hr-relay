import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { personLookupActiveStatusDefinition } from "./steps/active-status/step.js";
import { personLookupCrmDatesDefinition } from "./steps/crm-dates/step.js";
import { personLookupCrossVerifyDefinition } from "./steps/cross-verify/step.js";
import { personLookupSearchingDefinition } from "./steps/searching/step.js";
import { personLookupStore } from "./task-registry.js";
import { personLookupWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: personLookupWorkflow,
  exposure: { kind: "public", order: 0 },
  queueCapabilities: { sessionItemScope: true, groupedBatchLayout: true, retryBatchMembers: true },
  store: personLookupStore,
  proofs: [
    defineStepProof(personLookupWorkflow, personLookupSearchingDefinition),
    defineStepProof(personLookupWorkflow, personLookupCrossVerifyDefinition),
    defineStepProof(personLookupWorkflow, personLookupActiveStatusDefinition),
    defineStepProof(personLookupWorkflow, personLookupCrmDatesDefinition),
  ],
} as const);
