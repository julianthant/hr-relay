import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { OnboardingReadHirePlan } from "../../../../models/workflows/onboarding/read-hire-plan.js";
import { onboardingWorkflow, CRM_DATA_STEP, ONBOARDING_NODE_PURPOSES } from "../../workflow.js";

const group = onboardingWorkflow.steps[0];
const plan = group?.[1].find(entry => entry.id === "hire-plan");
if (group === undefined || plan === undefined) throw new Error("Onboarding CRM proof requires the authored hire-plan checkpoint");

export const onboardingCrmDataWorkflow = defineWorkflow({
  ...onboardingWorkflow, id: "onboarding-crm-data", code: "onc", label: CRM_DATA_STEP.label, details: [],
  role: defineWorkflowRole({ kind: "chunk-harness", of: "onboarding", step: CRM_DATA_STEP.key }),
  nodePurposes: ONBOARDING_NODE_PURPOSES.filter(node => group[1].some(entry => entry.id === node.nodeId)),
  steps: ({ result }) => ({ steps: [[CRM_DATA_STEP, group[1]]],
    result: result(OnboardingReadHirePlan.output, [plan], ({ outputs }) => OnboardingReadHirePlan.output.parse(outputs["hire-plan"])) }),
});
