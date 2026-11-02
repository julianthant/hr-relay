import type { z } from "zod";
import { I9LookupInputSchema, I9SignerOutputSchema } from "../../../models/systems/i9/read-section2-signer.js";
import type { HirePlanSchema } from "../../../models/workflows/onboarding/read-hire-plan.js";
import { ItemIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { deriveItemId } from "../../../rules/identity/logical-item.js";
import { i9LookupWorkflow } from "../../i9-lookup/workflow.js";

export const onboardingI9Target = Object.freeze({ id: WorkflowIdSchema.parse(i9LookupWorkflow.id), input: I9LookupInputSchema, result: I9SignerOutputSchema });
export function i9LookupInput(plan: z.output<typeof HirePlanSchema>): z.input<typeof I9LookupInputSchema> {
  return { firstName: plan.employee.firstName, lastName: plan.employee.lastName,
    ...(plan.employee.ssn === null ? {} : { ssn: plan.employee.ssn }) };
}
export function i9LookupItemId(input: z.output<typeof I9LookupInputSchema>) {
  return ItemIdSchema.parse(deriveItemId(i9LookupWorkflow.id, i9LookupWorkflow.identity.matchKey(input)));
}
