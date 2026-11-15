import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { OnboardingInput, OnboardingCanonicalInput } from "../../models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_OUTPUT_FIELDS, ONBOARDING_ROSTER_TYPE_ID } from "../../models/workflows/onboarding/roster.js";
import { onboardingCrmDataDefinition } from "./steps/crm-data/step.js";
import { onboardingUcpathSearchDefinition } from "./steps/ucpath-search/step.js";
import { onboardingI9SearchDefinition } from "./steps/i9-search/step.js";
import { onboardingHireWritesDefinition, buildHireReview } from "./steps/hire-review/step.js";

export const onboardingWorkflow = defineWorkflow({
  id: "onboarding", version: 3, code: "on", label: "Onboarding", icon: "UserPlus", category: "onboarding",
  requiredWorkbookFields: [...ONBOARDING_ROSTER_FIELDS],
  workbookReference: { id: ONBOARDING_ROSTER_TYPE_ID, keyFieldId: "email", mode: "keys", writableFields: [...ONBOARDING_ROSTER_OUTPUT_FIELDS] },
  referenceKeys: input => [input.email],
  summary: "Review CRM hire data, independently confirmed UCPath identities and complete transaction findings. Create or reuse the I-9 record, verify the filed hire and fill result cells through the captured master reference.",
  input: OnboardingInput, canonicalInput: OnboardingCanonicalInput, inputSubject: "email",
  surface: { shape: "single" }, surfaces: { inputRun: {
    placeholder: "Email from the saved roster row",
    parser: { split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "email" }, emit: "email" }] },
    workbookRows: { typeId: ONBOARDING_ROSTER_TYPE_ID, inputField: "email" },
    typedInput: { modeField: "mode", modeLabel: "Hire mode", initialMode: null,
      description: "Choose saved roster rows and a hire mode. Each selected row starts one run.", controls: [],
      modes: [
        { value: "new-hire", label: "New hire", inputLabel: "Email", hint: "Email from the saved roster row", placeholder: "hire@example.test", defaults: [],
          parser: { kind: "entries", spec: { split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "email" }, emit: "email" }] } },
          display: { kind: "first-present", fields: ["email"] }, identityFields: ["email"] },
        { value: "rehire", label: "Rehire", inputLabel: "Email", hint: "Email from the saved roster row", placeholder: "hire@example.test", defaults: [],
          parser: { kind: "entries", spec: { split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "email" }, emit: "email" }] } },
          display: { kind: "first-present", fields: ["email"] }, identityFields: ["email"] },
      ],
    },
  } }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["onboarding/crm-extraction", "onboarding/write-transactions"],
  identity: { matchKey: input => input.email.toLowerCase() },
  presentation: { title: input => input.email, subtitle: () => "Reviewed hire filing · verified master results" },
  outcomeProjection: { fieldPath: "state", cases: [{ value: "filed", label: "Hire filed", tone: "success" }, { value: "master-review-required", label: "Master needs review", tone: "warning" }] },
  details: [
    { key: "hire-write", label: "Hire submission", source: { kind: "result", fieldPath: "hireWrite.state" }, display: "badge" },
    { key: "subject", label: "UCPath match", source: { kind: "result", fieldPath: "subject.state" }, display: "badge" },
    { key: "i9-plan", label: "I-9 record", source: { kind: "result", fieldPath: "i9.state" }, display: "badge" },
    { key: "roster-access", label: "Master result cells", source: { kind: "result", fieldPath: "rosterAccess.state" }, display: "badge" },
  ], verdicts: [],
  nodePurposes: [...onboardingCrmDataDefinition.nodePurposes, ...onboardingUcpathSearchDefinition.nodePurposes,
    ...onboardingI9SearchDefinition.nodePurposes, ...onboardingHireWritesDefinition.nodePurposes],
  steps: author => {
    const crm = onboardingCrmDataDefinition.build(author);
    const ucpath = onboardingUcpathSearchDefinition.build(author, crm);
    const i9 = onboardingI9SearchDefinition.build(author, crm, ucpath);
    const reviewed = buildHireReview(author, crm, ucpath, i9);
    const writes = onboardingHireWritesDefinition.build(author, crm, ucpath, i9, reviewed);
    return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps, ...reviewed.steps, ...writes.steps], result: writes.result };
  },
});
