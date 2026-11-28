import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { EmergencyContactMemberCanonicalInput,EmergencyContactMemberInputSchema } from "../../models/workflows/emergency-contact-member/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { CONTACT_PLAN_MANUAL, contactPlanDefinition } from "./steps/contact-plan/step.js";
import { contactPreviewDefinition } from "./steps/contact-preview/step.js";
import { onbaseFilingDefinition } from "./steps/onbase-filing/step.js";
import { defineReferenceCheck } from "../../workflow-kit/reference-check.js";

export const EMERGENCY_CONTACT_SCENARIOS = ["emergency-contact/unambiguous-addition", "emergency-contact/exact-existing-effect",
  "emergency-contact/conflict-refused", "emergency-contact/dry-run", "emergency-contact/unknown", "emergency-contact/verified-save", "emergency-contact-member/reference-check"] as const;
export const emergencyContactMemberWorkflow = defineWorkflow({
  id: "emergency-contact-member", version: 1, code: "em", label: "Emergency Contact member", icon: "Users", category: "documents",
  summary: "Authenticates one approved OCR record, saves its ordered primary contact changes in UCPath and files its source page to OnBase.", requiredWorkbookFields: [], referenceCheck: defineReferenceCheck({ key: "eid", input: { eid: "record.assertedEid" }, manual: "review-on-own-start",
    writeReview: { source: "read-contacts", before: ["contact-plan"] }, outputs: {
    "map-contact": { eid: "emplId", fullName: "expectedName" },
    "read-contacts": { eid: "contacts.emplId", fullName: "contacts.displayedName" },
  } }),
  input: EmergencyContactMemberInputSchema, canonicalInput: EmergencyContactMemberCanonicalInput, inputSubject: "eid",
  surface: { shape: "operation-member" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {},
  role: defineWorkflowRole({ kind: "composition" }), identity: { matchKey: input => `${input.approval.sourceRunId}:${input.record.recordId}` },
  presentation: { title: input => input.record.assertedEid ?? input.record.recordId, subtitle: () => "Primary Emergency Contact" },
  details: [{ key: "disposition", label: "Result", source: { kind: "result", fieldPath: "disposition" }, display: "text" }],
  scenarios: EMERGENCY_CONTACT_SCENARIOS,
  nodePurposes: [
    { nodeId: "map-contact", purpose: "Map only approved contact fields." },
    { nodeId: "approved-record", purpose: "Authenticate the exact current released OCR record and native member lineage." },
    { nodeId: "read-contacts", purpose: "Open the employee contact editor and capture the complete saved contact set." },
    { nodeId: "contact-plan", purpose: "Declare the ordered primary demotion and addition bound to the exact original contact set." },
    { nodeId: "contact-preview", purpose: "Probe exact presence, prepare and save the approved primary contact plan, then verify persisted contacts." },
    { nodeId: "onbase-filing", purpose: "File the record's first source page to OnBase through one child once the Save settles." },
  ],
  steps: author => {
    const plan = contactPlanDefinition.build(author, CONTACT_PLAN_MANUAL);
    const preview = contactPreviewDefinition.build(author, plan, true);
    const filing = onbaseFilingDefinition.build(author, { contactPlanSwitch: true });
    return { steps: [...plan.steps, ...preview.steps, ...filing.steps], result: preview.result };
  },
});
