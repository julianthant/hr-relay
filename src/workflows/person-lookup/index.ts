import { deepFreeze } from "../../rules/validation/immutability.js";
import { personLookupWorkflow } from "./workflow.js";
import { personLookupStore } from "./task-registry.js";
import { personLookupSearchingWorkflow } from "./steps/searching/step.js";
import { personLookupCrossVerifyWorkflow } from "./steps/cross-verify/step.js";
import { personLookupActiveStatusWorkflow } from "./steps/active-status/step.js";
import { personLookupCrmDatesWorkflow } from "./steps/crm-dates/step.js";

export const registration = deepFreeze({
  definition: personLookupWorkflow,
  exposure: { kind: "public", order: 0 },
  store: personLookupStore,
  proofs: [
    { definition: personLookupSearchingWorkflow, order: 5 },
    { definition: personLookupCrossVerifyWorkflow, order: 6 },
    { definition: personLookupActiveStatusWorkflow, order: 7 },
    { definition: personLookupCrmDatesWorkflow, order: 8 },
  ],
} as const);
