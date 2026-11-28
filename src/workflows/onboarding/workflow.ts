import { defineWorkflow, REFERENCE_CHECK_STEP } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { OnboardingInput, OnboardingCanonicalInput } from "../../models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_OUTPUT_FIELDS, ONBOARDING_ROSTER_TYPE_ID } from "../../models/workflows/onboarding/roster.js";
import { onboardingCrmDataDefinition } from "./steps/crm-data/step.js";
import { onboardingUcpathSearchDefinition } from "./steps/ucpath-search/step.js";
import { onboardingI9SearchDefinition } from "./steps/i9-search/step.js";
import { onboardingHireWritesDefinition, buildHireReview } from "./steps/hire-review/step.js";
import { defineReferenceCheck } from "../../workflow-kit/reference-check.js";

export const onboardingWorkflow = defineWorkflow({
  id: "onboarding", version: 3, code: "on", label: "Onboarding", icon: "UserPlus", category: "onboarding",
  requiredWorkbookFields: [...ONBOARDING_ROSTER_FIELDS],
  workbookReference: { id: ONBOARDING_ROSTER_TYPE_ID, keyFieldId: "email", mode: "keys", writableFields: [...ONBOARDING_ROSTER_OUTPUT_FIELDS] },
  referenceCheck: defineReferenceCheck({ key: "email", input: { email: "email" }, manual: "values", outputs: {
    "crm-source": { email: "requestedEmail", fullName: ["recordFirstName", "recordLastName"], firstName: "recordFirstName", lastName: "recordLastName", dob: "fields.dob" },
    "hire-plan": { dob: "employee.dob" },
    "ucpath-source": { eid: "confirmed[].emplId", fullName: "confirmed[].name" },
    "hire-subject": { eid: "person.emplId", fullName: "person.name" },
    "write-plan": { eid: "hire.emplId", fullName: "hire.expectedName" },
    "hire-receipt": { eid: "emplId", fullName: "displayedName", dob: "dob", email: "email" },
    "concurrent-hire-receipt": { eid: "emplId", fullName: "displayedName", dob: "dob", email: "email" },
  } }),
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
        { value: "new-hire", label: "New hire", inputLabel: "Email", placeholder: "hire@example.test", defaults: [],
          parser: { kind: "entries", spec: { split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "email" }, emit: "email" }] } },
          display: { kind: "first-present", fields: ["email"] }, identityFields: ["email"] },
        { value: "rehire", label: "Rehire", inputLabel: "Email", placeholder: "hire@example.test", defaults: [],
          parser: { kind: "entries", spec: { split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "email" }, emit: "email" }] } },
          display: { kind: "first-present", fields: ["email"] }, identityFields: ["email"] },
      ],
    },
  } }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["onboarding/crm-extraction", "onboarding/write-transactions", "onboarding/reference-check"],
  identity: { matchKey: input => input.email.toLowerCase() },
  presentation: { title: input => input.email, subtitle: () => "Reviewed hire filing · verified master results" },
  outcomeProjection: { fieldPath: "state", cases: [{ value: "filed", label: "Hire filed", tone: "success" }, { value: "master-review-required", label: "Master needs review", tone: "warning" },
    { value: "completed-with-manual-steps", label: "Completed with manual steps", tone: "warning" }] },
  details: [
    { key: "hire-write", label: "Hire submission", source: { kind: "result", fieldPath: "hireWrite.state" }, display: "badge" },
    { key: "subject", label: "UCPath match", source: { kind: "result", fieldPath: "subject.state" }, display: "badge" },
    { key: "i9-plan", label: "I-9 record", source: { kind: "result", fieldPath: "i9.state" }, display: "badge" },
    { key: "roster-access", label: "Master result cells", source: { kind: "result", fieldPath: "rosterAccess.state" }, display: "badge" },
  ], verdicts: [],
  nodePurposes: [...onboardingCrmDataDefinition.nodePurposes, ...onboardingUcpathSearchDefinition.nodePurposes,
    ...onboardingI9SearchDefinition.nodePurposes, ...onboardingHireWritesDefinition.nodePurposes],
  rows: [
    { key: "crm-data", label: "Read entry sheet", members: [{ step: "crm-data" }], target: { step: "crm-data" } },
    { key: "ucpath-search", label: "Match existing person", members: [{ step: "ucpath-search" }], target: { step: "ucpath-search" } },
    { key: "i9-search", label: "Search I-9 profiles", members: [{ step: "i9-search" }], target: { step: "i9-search" } },
    { key: "hire-review", label: "Review hire findings", members: [{ step: "hire-review" }], target: { step: "hire-review" } },
    { key: "reference-check", label: REFERENCE_CHECK_STEP.label, members: [{ step: "reference-check" }], target: { step: "reference-check" } },
    { key: "i9-creation", label: "Create I-9 profile", members: [{ step: "i9-creation" }], target: { step: "i9-creation" } },
    { key: "ucpath-hire", label: "Submit hire", members: [{ step: "ucpath-hire" }], target: { step: "ucpath-hire" } },
    { key: "master-results", label: "Fill master results", members: [{ step: "master-results" }], target: { step: "master-results" } },
  ],
  steps: author => {
    const crm = onboardingCrmDataDefinition.build(author);
    const ucpath = onboardingUcpathSearchDefinition.build(author, crm);
    const i9 = onboardingI9SearchDefinition.build(author, crm, ucpath);
    const reviewed = buildHireReview(author, crm, ucpath, i9);
    const writes = onboardingHireWritesDefinition.build(author, crm, ucpath, i9, reviewed);
    return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps, ...reviewed.steps, ...writes.steps], result: writes.result };
  },
});
