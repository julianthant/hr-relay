import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { EmergencyContactMemberCanonicalInput,EmergencyContactMemberInputSchema } from "../../models/workflows/emergency-contact-member/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { CONTACT_PLAN_MANUAL, contactPlanDefinition } from "./steps/contact-plan/step.js";
import { contactPreviewDefinition } from "./steps/contact-preview/step.js";
import { onbaseFilingDefinition } from "./steps/onbase-filing/step.js";
import { emergencyContactMemberReferenceCheckDefinition } from "./steps/reference-check/step.js";
import { REFERENCE_CHECK } from "../../models/processing/workbooks/verify-person.js";

export const EMERGENCY_CONTACT_SCENARIOS = ["emergency-contact/unambiguous-addition", "emergency-contact/exact-existing-effect",
  "emergency-contact/conflict-refused", "emergency-contact/dry-run", "emergency-contact/unknown", "emergency-contact/verified-save", "emergency-contact-member/reference-check"] as const;
export const emergencyContactMemberWorkflow = defineWorkflow({
  id: "emergency-contact-member", version: 1, code: "em", label: "Emergency Contact member", icon: "Users", category: "documents",
  summary: "Authenticates one approved OCR record, saves its ordered primary contact changes in UCPath and files its source page to OnBase.", requiredWorkbookFields: [], workbookCheck: REFERENCE_CHECK,
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
    { nodeId: "reference-check", purpose: "Look the employee's Employee ID up in each picked reference spreadsheet without reading a row value back." },
    { nodeId: "reference-stop", purpose: "Ask before the Save only in a live run whose picked spreadsheets do not confirm the employee." },
    { nodeId: "reference-check-review", purpose: "Have the operator continue anyway, or cancel this member, before its contact is saved." },
    { nodeId: "contact-preview", purpose: "Probe exact presence, prepare and save the approved primary contact plan, then verify persisted contacts." },
    { nodeId: "onbase-filing", purpose: "File the record's first source page to OnBase through one child once the Save settles." },
  ],
  steps: author => {
    const plan = contactPlanDefinition.build(author, CONTACT_PLAN_MANUAL), reference = emergencyContactMemberReferenceCheckDefinition.build(author, plan);
    const preview = contactPreviewDefinition.build(author, plan, reference);
    const filing = onbaseFilingDefinition.build(author, { contactPlanSwitch: true });
    return { steps: [...plan.steps, ...reference.steps, ...preview.steps, ...filing.steps], result: preview.result };
  },
});
