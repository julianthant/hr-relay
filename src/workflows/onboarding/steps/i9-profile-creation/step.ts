import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { OnboardingReadI9ProfilePlan } from "../../../../models/workflows/onboarding/i9-profile.js";
import { onboardingWorkflow, ONBOARDING_STEPS, I9_CREATE_STEP } from "../../workflow.js";

const group = onboardingWorkflow.steps[3];
const profile = group?.[1].find(entry => entry.id === "i9-profile-plan");
if (group === undefined || profile === undefined) throw new Error("Onboarding profile proof requires the authored creation plan");

export const onboardingI9ProfileCreationWorkflow = defineWorkflow({
  ...onboardingWorkflow, id: "onboarding-i9-profile-creation", code: "onip", label: I9_CREATE_STEP.label, details: [],
  role: defineWorkflowRole({ kind: "chunk-harness", of: "onboarding", step: I9_CREATE_STEP.key }),
  steps: ({ result }) => ({ steps: onboardingWorkflow.steps.map(([, entries], index) => {
    const step = ONBOARDING_STEPS[index];
    if (step === undefined) throw new Error("Onboarding proof has an undeclared step");
    return [step, entries];
  }), result: result(OnboardingReadI9ProfilePlan.output, [profile], ({ outputs }) => OnboardingReadI9ProfilePlan.output.parse(outputs["i9-profile-plan"])) }),
});
