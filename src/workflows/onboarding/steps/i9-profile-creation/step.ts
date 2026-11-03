import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingReadI9ProfilePlan } from "../../../../models/workflows/onboarding/read-i9-profile-plan.js";
import { OnboardingResultSchema } from "../../../../models/workflows/onboarding/result.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildCrmData } from "../crm-data/step.js";
import { buildUcpathSearch } from "../ucpath-search/step.js";
import { buildI9Search } from "../i9-search/step.js";

const group = defineWorkflowStep({ key: "i9-profile-creation", label: "Plan I-9 profile creation" });
const entries = defineStepEntries(group);

export function buildI9ProfileCreation(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>,
  ucpath: ReturnType<typeof buildUcpathSearch>, i9: ReturnType<typeof buildI9Search>) {
  const profile = author.task(entries.task("i9-profile-plan", OnboardingReadI9ProfilePlan, { replay: "checkpoint" }), [crm.plan, i9.lookup], ({ outputs }) => ({
    plan: outputs["hire-plan"], lookup: outputs["i9-lookup"],
  }));
  return { profile, steps: [[group, [profile]]] as const,
    result: author.result(OnboardingResultSchema, [crm.plan, ucpath.subject, profile], ({ outputs }) => ({
      state: "implementation-incomplete", plan: outputs["hire-plan"], subject: outputs["hire-subject"], i9: outputs["i9-profile-plan"],
      hireWrite: { state: "unimplemented", owner: "write-safety" }, rosterAccess: { state: "snapshot-bound", owner: "spreadsheets" },
    } as const)) };
}

export const onboardingI9ProfileCreationDefinition = defineStep({
  group, build: buildI9ProfileCreation,
  nodePurposes: [
    { nodeId: "i9-profile-plan", purpose: "Reuse a proven profile ID or declare the unimplemented creation write without submitting." },
  ],
  proof: {
    id: "onboarding-i9-profile-creation", order: 18,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onip", label: group.label, summary: parent.summary,
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author);
        const ucpath = buildUcpathSearch(author, crm);
        const i9 = buildI9Search(author, crm, ucpath);
        const creation = buildI9ProfileCreation(author, crm, ucpath, i9);
        return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps, ...creation.steps],
          result: author.result(OnboardingReadI9ProfilePlan.output, [creation.profile], ({ outputs }) => OnboardingReadI9ProfilePlan.output.parse(outputs["i9-profile-plan"])) };
      },
    }),
  },
});
