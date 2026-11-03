import { OnboardingInput, type OnboardingInputValue } from "../../../../models/workflows/onboarding/input.js";
import { CrmReadHireData } from "../../../../models/systems/crm/read-hire-data.js";
import { OnboardingReadHirePlan } from "../../../../models/workflows/onboarding/read-hire-plan.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof, reuseTask } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

const group = defineWorkflowStep({ key: "crm-data", label: "Read and validate hire data" });
const entries = defineStepEntries(group);

export function buildCrmData(author: WorkflowAuthor<typeof OnboardingInput>) {
  const call = reuseTask(group, { id: "crm-source", contract: CrmReadHireData, replay: "always-rerun" },
    (input: OnboardingInputValue) => ({ email: input.email }));
  const source = author.task(call.identity, [], call.bind);
  const plan = author.task(entries.task("hire-plan", OnboardingReadHirePlan, { replay: "checkpoint" }), [source], ({ input, outputs }) => ({
    crm: outputs["crm-source"], roster: input.roster,
    ...(input.postalCodeOverride === undefined ? {} : { postalCodeOverride: input.postalCodeOverride }),
    ...(input.configuredJobEndDate === undefined ? {} : { configuredJobEndDate: input.configuredJobEndDate }),
  }));
  return { source, plan, steps: [[group, [source, plan]]] as const,
    result: author.result(OnboardingReadHirePlan.output, [plan], ({ outputs }) => OnboardingReadHirePlan.output.parse(outputs["hire-plan"])) };
}

export const onboardingCrmDataDefinition = defineStep({
  group, build: buildCrmData,
  nodePurposes: [
    { nodeId: "crm-source", purpose: "Read the exact email-bound CRM hire record through the existing driver task." },
    { nodeId: "hire-plan", purpose: "Validate hire values using legal and lived names from the supplied run-start roster snapshot." },
  ],
  proof: {
    id: "onboarding-crm-data", order: 15,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onc", label: group.label, summary: parent.summary,
      steps: buildCrmData,
    }),
  },
});
