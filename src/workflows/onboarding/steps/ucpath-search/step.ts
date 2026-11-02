import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { OnboardingMatchHireSubject } from "../../../../models/workflows/onboarding/match-hire-subject.js";
import { onboardingWorkflow, CRM_DATA_STEP, UCPATH_SEARCH_STEP, ONBOARDING_NODE_PURPOSES } from "../../workflow.js";

const crm = onboardingWorkflow.steps[0], group = onboardingWorkflow.steps[1];
const subject = group?.[1].find(entry => entry.id === "hire-subject");
if (crm === undefined || group === undefined || subject === undefined) throw new Error("Onboarding UCPath proof requires its prerequisite checkpoints");

export const onboardingUcpathSearchWorkflow = defineWorkflow({
  ...onboardingWorkflow, id: "onboarding-ucpath-search", code: "onu", label: UCPATH_SEARCH_STEP.label, details: [],
  role: defineWorkflowRole({ kind: "chunk-harness", of: "onboarding", step: UCPATH_SEARCH_STEP.key }),
  nodePurposes: ONBOARDING_NODE_PURPOSES.filter(node => [...crm[1], ...group[1]].some(entry => entry.id === node.nodeId)),
  steps: ({ result }) => ({ steps: [[CRM_DATA_STEP, crm[1]], [UCPATH_SEARCH_STEP, group[1]]],
    result: result(OnboardingMatchHireSubject.output, [subject], ({ outputs }) => OnboardingMatchHireSubject.output.parse(outputs["hire-subject"])) }),
});
