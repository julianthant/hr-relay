import type { z } from "zod";
import { I9LookupInputSchema, I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingReadI9Lookup } from "../../../../models/workflows/onboarding/read-i9-lookup.js";
import type { HirePlanSchema } from "../../../../models/workflows/onboarding/read-hire-plan.js";
import { ItemIdSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { deriveItemId } from "../../../../rules/identity/logical-item.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { i9LookupWorkflow } from "../../../i9-lookup/workflow.js";
import { buildCrmData } from "../crm-data/step.js";
import { buildUcpathSearch } from "../ucpath-search/step.js";
import { hireReviewChoices } from "../../../../rules/onboarding/match-hire-subject.js";

const group = Object.freeze({
  ...defineWorkflowStep({ key: "i9-search", label: "Search I-9 profiles" }),
  review: { pages: [], branchLabels: [] } as const
});
const entries = defineStepEntries(group);
const target = Object.freeze({ id: WorkflowIdSchema.parse(i9LookupWorkflow.id), input: I9LookupInputSchema, result: I9SignerOutputSchema });

export function i9LookupInput(plan: z.output<typeof HirePlanSchema>): z.input<typeof I9LookupInputSchema> {
  return { firstName: plan.employee.firstName, lastName: plan.employee.lastName,
    ...(plan.employee.ssn === null ? {} : { ssn: plan.employee.ssn }) };
}
export function i9LookupItemId(input: z.output<typeof I9LookupInputSchema>) {
  return ItemIdSchema.parse(deriveItemId(i9LookupWorkflow.id, i9LookupWorkflow.identity.matchKey(input)));
}

export function buildI9Search(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>, ucpath: ReturnType<typeof buildUcpathSearch>) {
  const child = author.delegate({
    step: group, id: "i9-lookup-child", target, edgeId: "onboarding-i9-lookup",
    cardinality: "many", await: "terminal", join: "all-settled",
    policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
  }, [crm.plan, ucpath.matches, ucpath.subject], {
    // Look up the I-9 profile whenever the operator may still choose a new hire.
    bind: ({ input, outputs }) => hireReviewChoices(input.mode, outputs["ucpath-source"], outputs["hire-plan"].employee).newHire ? [i9LookupInput(outputs["hire-plan"])] : [],
    deriveChildItemId: input => i9LookupItemId(input),
  });
  const lookup = author.task(entries.task("i9-lookup", OnboardingReadI9Lookup, { replay: "checkpoint" }), [crm.plan, ucpath.subject, child], ({ outputs }) => ({
    subject: outputs["hire-subject"], expectedItemId: i9LookupItemId(i9LookupInput(outputs["hire-plan"])),
    outcomes: [...outputs["i9-lookup-child"]],
  }));
  return { child, lookup, steps: [[group, [child, lookup]]] as const,
    result: author.result(OnboardingReadI9Lookup.output, [lookup], ({ outputs }) => OnboardingReadI9Lookup.output.parse(outputs["i9-lookup"])) };
}

export const onboardingI9SearchDefinition = defineStep({
  group, build: buildI9Search,
  nodePurposes: [
    { nodeId: "i9-lookup-child", purpose: "Delegate the new hire's lookup to the registered I-9 Lookup child workflow." },
    { nodeId: "i9-lookup", purpose: "Retain only the exact successful child result; failure never proves profile absence." },
  ],
  proof: {
    id: "onboarding-i9-search", order: 17,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onis", label: group.label, summary: parent.summary,
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author);
        const ucpath = buildUcpathSearch(author, crm);
        const i9 = buildI9Search(author, crm, ucpath);
        return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps], result: i9.result };
      },
    }),
  },
});
