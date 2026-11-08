import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { EmergencyContactMemberCanonicalInput,EmergencyContactMemberInputSchema } from "../../models/workflows/emergency-contact-member/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { contactPlanDefinition } from "./steps/contact-plan/step.js";
import { contactPreviewDefinition } from "./steps/contact-preview/step.js";

export const EMERGENCY_CONTACT_SCENARIOS = ["emergency-contact/unambiguous-addition", "emergency-contact/exact-existing-effect",
  "emergency-contact/conflict-refused", "emergency-contact/dry-run", "emergency-contact/unknown", "emergency-contact/verified-save"] as const;
export const emergencyContactMemberWorkflow = defineWorkflow({
  id: "emergency-contact-member", version: 1, code: "em", label: "Emergency Contact member", icon: "Users", category: "documents",
  summary: "Authenticates one approved OCR record and saves its ordered primary contact changes in UCPath.", requiredWorkbookTypeIds: [],
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
  ],
  steps: author => {
    const plan = contactPlanDefinition.build(author), preview = contactPreviewDefinition.build(author, plan);
    return { steps: [...plan.steps, ...preview.steps], result: preview.result };
  },
});
