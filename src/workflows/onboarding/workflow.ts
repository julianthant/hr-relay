import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { OnboardingInput, OnboardingCanonicalInput } from "../../models/workflows/onboarding/input.js";
import { onboardingCrmDataDefinition } from "./steps/crm-data/step.js";
import { onboardingUcpathSearchDefinition } from "./steps/ucpath-search/step.js";
import { onboardingI9SearchDefinition } from "./steps/i9-search/step.js";
import { onboardingI9ProfileCreationDefinition } from "./steps/i9-profile-creation/step.js";

export const onboardingWorkflow = defineWorkflow({
  id: "onboarding", version: 1, code: "on", label: "Onboarding", icon: "UserPlus", category: "onboarding",
  summary: "Validates hire inputs and delegates I-9 lookup; profile creation, hire writes and roster access remain unimplemented.",
  input: OnboardingInput, canonicalInput: OnboardingCanonicalInput, inputSubject: "email",
  surface: { shape: "single" }, surfaces: {}, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["onboarding/crm-extraction"],
  identity: { matchKey: input => input.email.toLowerCase() },
  presentation: { title: input => input.email }, details: [], verdicts: [],
  nodePurposes: [...onboardingCrmDataDefinition.nodePurposes, ...onboardingUcpathSearchDefinition.nodePurposes,
    ...onboardingI9SearchDefinition.nodePurposes, ...onboardingI9ProfileCreationDefinition.nodePurposes],
  steps: author => {
    const crm = onboardingCrmDataDefinition.build(author);
    const ucpath = onboardingUcpathSearchDefinition.build(author, crm);
    const i9 = onboardingI9SearchDefinition.build(author, crm, ucpath);
    const creation = onboardingI9ProfileCreationDefinition.build(author, crm, ucpath, i9);
    return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps, ...creation.steps], result: creation.result };
  },
});
