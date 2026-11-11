import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { EmergencyContactMemberCanonicalInput,EmergencyContactMemberInputSchema } from "../../models/workflows/emergency-contact-member/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { contactPlanDefinition } from "./steps/contact-plan/step.js";
import { contactPreviewDefinition } from "./steps/contact-preview/step.js";
import { onbaseImportDefinition } from "./steps/onbase-import/step.js";

export const EMERGENCY_CONTACT_SCENARIOS = ["emergency-contact/unambiguous-addition", "emergency-contact/exact-existing-effect",
  "emergency-contact/conflict-refused", "emergency-contact/dry-run", "emergency-contact/unknown", "emergency-contact/verified-save"] as const;
export const emergencyContactMemberWorkflow = defineWorkflow({
  id: "emergency-contact-member", version: 1, code: "em", label: "Emergency Contact member", icon: "Users", category: "documents",
  summary: "Authenticates one approved OCR record, saves its ordered primary contact changes in UCPath, then imports its PDF page to OnBase.", requiredWorkbookFields: [],
  input: EmergencyContactMemberInputSchema, canonicalInput: EmergencyContactMemberCanonicalInput, inputSubject: "eid",
  surface: { shape: "operation-member" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {},
  role: defineWorkflowRole({ kind: "composition" }), identity: { matchKey: input => `${input.approval.sourceRunId}:${input.record.recordId}` },
  presentation: { title: input => input.record.assertedEid ?? input.record.recordId, subtitle: () => "Primary Emergency Contact" },
  details: [{ key: "disposition", label: "Result", source: { kind: "result", fieldPath: "disposition" }, display: "text" },
    { key: "onbase-document", label: "OnBase document", source: { kind: "result", fieldPath: "onbase.savedDocument.documentId" }, display: "text" }],
  scenarios: EMERGENCY_CONTACT_SCENARIOS,
  nodePurposes: [
    { nodeId: "map-contact", purpose: "Map only approved contact fields." },
    { nodeId: "approved-record", purpose: "Authenticate the exact current released OCR record and native member lineage." },
    { nodeId: "read-contacts", purpose: "Open the employee contact editor and capture the complete saved contact set." },
    { nodeId: "contact-plan", purpose: "Declare the ordered primary demotion and addition bound to the exact original contact set." },
    { nodeId: "contact-preview", purpose: "Probe exact presence, prepare and save the approved primary contact plan, then verify persisted contacts." },
    { nodeId: "onbase-import", purpose: "Import the approved PDF page to OnBase for the same employee after the contact Save settles." },
  ],
  steps: author => {
    const plan = contactPlanDefinition.build(author), preview = contactPreviewDefinition.build(author, plan), onbase = onbaseImportDefinition.build(author, plan, preview);
    return { steps: [...plan.steps, ...preview.steps, ...onbase.steps], result: onbase.result };
  },
});
