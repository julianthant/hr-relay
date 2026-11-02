import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { OnboardingReadI9Lookup } from "../../../../models/workflows/onboarding/i9-profile.js";
import { onboardingWorkflow, CRM_DATA_STEP, UCPATH_SEARCH_STEP, I9_SEARCH_STEP, ONBOARDING_NODE_PURPOSES } from "../../workflow.js";

const crm = onboardingWorkflow.steps[0], ucpath = onboardingWorkflow.steps[1], group = onboardingWorkflow.steps[2];
const lookup = group?.[1].find(entry => entry.id === "i9-lookup");
if (crm === undefined || ucpath === undefined || group === undefined || lookup === undefined) throw new Error("Onboarding I-9 proof requires its prerequisite checkpoints");

export const onboardingI9SearchWorkflow = defineWorkflow({
  ...onboardingWorkflow, id: "onboarding-i9-search", code: "onis", label: I9_SEARCH_STEP.label, details: [],
  role: defineWorkflowRole({ kind: "chunk-harness", of: "onboarding", step: I9_SEARCH_STEP.key }),
  nodePurposes: ONBOARDING_NODE_PURPOSES.filter(node => [...crm[1], ...ucpath[1], ...group[1]].some(entry => entry.id === node.nodeId)),
  steps: ({ result }) => ({ steps: [[CRM_DATA_STEP, crm[1]], [UCPATH_SEARCH_STEP, ucpath[1]], [I9_SEARCH_STEP, group[1]]],
    result: result(OnboardingReadI9Lookup.output, [lookup], ({ outputs }) => OnboardingReadI9Lookup.output.parse(outputs["i9-lookup"])) }),
});
