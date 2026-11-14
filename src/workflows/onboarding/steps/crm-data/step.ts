import { OnboardingInput, OnboardingCanonicalValueSchema, type OnboardingInputValue } from "../../../../models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_GATE_ID, OnboardingRosterChoiceSchema } from "../../../../models/workflows/onboarding/roster.js";
import { CrmReadHireData } from "../../../../models/systems/crm/read-hire-data.js";
import { OnboardingReadHirePlan } from "../../../../models/workflows/onboarding/read-hire-plan.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof, reuseTask } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

const group = Object.freeze({
  ...defineWorkflowStep({ key: "crm-data", label: "Read and validate hire data" }),
  review: {
    pages: [
      {
        id: "crm-hire-record",
        title: "CRM onboarding record",
        mode: "Read only",
        nodeIds: ["crm-source"],
        lines: [{ id: "read-hire", kind: "read", text: "Read the exact email-bound CRM hire record.", nodeIds: ["crm-source"] }],
        fields: []
      }
    ],
    branchLabels: []
  } as const
});
const entries = defineStepEntries(group);

export function buildCrmData(author: WorkflowAuthor<typeof OnboardingInput>) {
  const choice = author.gate({ id: ONBOARDING_ROSTER_GATE_ID, label: "Choose roster row", statusKey: "awaitingRosterRowChoice",
    result: OnboardingRosterChoiceSchema,
    when: { kind: "equals", of: { from: "input", path: "roster.state" }, value: "resolve-required" },
  }, []);
  const call = reuseTask(group, { id: "crm-source", contract: CrmReadHireData, replay: "always-rerun" },
    (input: OnboardingInputValue) => ({ email: input.email }));
  const source = author.task(call.identity, [choice], call.bind);
  const plan = author.task(entries.task("hire-plan", OnboardingReadHirePlan, { replay: "always-rerun" }), [source, choice], ({ input, outputs }) => {
    const roster = OnboardingCanonicalValueSchema.parse(input).roster;
    return {
      crm: outputs["crm-source"], roster: roster.state === "resolved" ? roster.row : OnboardingRosterChoiceSchema.parse(outputs[ONBOARDING_ROSTER_GATE_ID]).row,
      ...(input.postalCodeOverride === undefined ? {} : { postalCodeOverride: input.postalCodeOverride }),
      ...(input.configuredJobEndDate === undefined ? {} : { configuredJobEndDate: input.configuredJobEndDate }),
    };
  });
  return { choice, source, plan, steps: [[group, [choice, source, plan]]] as const,
    result: author.result(OnboardingReadHirePlan.output, [plan], ({ outputs }) => OnboardingReadHirePlan.output.parse(outputs["hire-plan"])) };
}

export const onboardingCrmDataDefinition = defineStep({
  group, build: buildCrmData,
  nodePurposes: [
    { nodeId: ONBOARDING_ROSTER_GATE_ID, purpose: "Hold missing or duplicate exact-key roster matches for a revalidated worksheet and row choice." },
    { nodeId: "crm-source", purpose: "Read the exact email-bound CRM hire record through the existing driver task." },
    { nodeId: "hire-plan", purpose: "Validate hire values and split the roster legal and lived names against the CRM record." },
  ],
  proof: {
    id: "onboarding-crm-data", order: 15,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onc", label: group.label, summary: parent.summary,
      steps: buildCrmData,
    }),
  },
});
