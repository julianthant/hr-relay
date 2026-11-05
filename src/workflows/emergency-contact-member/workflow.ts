import { UcpathProbeEmergencyContact } from "../../models/systems/ucpath/match-emergency-contact-plan.js";
import { UcpathVerifyEmergencyContact } from "../../models/systems/ucpath/verify-emergency-contact-plan.js";
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
  operationDisplay: { capability: "complete", version: 1,
    transactionReads: [{ entryId: "contact-preview", role: "probe", contract: UcpathProbeEmergencyContact },
      { entryId: "contact-preview", role: "verify", contract: UcpathVerifyEmergencyContact }],
    invocations: [
      { id: "approved-record", entryId: "approved-record", contractRole: "task", occurrencePath: ["approved-record"], bindings: [] },
      { id: "map-contact", entryId: "map-contact", contractRole: "task", occurrencePath: ["map-contact"], bindings: [] },
      { id: "read-contacts", entryId: "read-contacts", contractRole: "task", occurrencePath: ["read-contacts"], bindings: [] },
      { id: "contact-plan", entryId: "contact-plan", contractRole: "task", occurrencePath: ["contact-plan"], bindings: [] },
      { id: "probe-contact", entryId: "contact-preview", contractRole: "probe", occurrencePath: ["contact-preview", "probe"], bindings: [] },
      { id: "prepare-contact", entryId: "contact-preview", contractRole: "prepare", occurrencePath: ["contact-preview", "prepare"], bindings: [] },
      { id: "save-contact", entryId: "contact-preview", contractRole: "commit", occurrencePath: ["contact-preview", "commit"], bindings: [] },
      { id: "verify-contact", entryId: "contact-preview", contractRole: "verify", occurrencePath: ["contact-preview", "verify"], bindings: [] },
    ], presentation: ["approved-record", "map-contact", "read-contacts", "contact-plan", "probe-contact", "prepare-contact", "save-contact", "verify-contact"]
      .map(id => ({ id, kind: "operation" as const, invocationId: id })),
  },
  steps: author => {
    const plan = contactPlanDefinition.build(author), preview = contactPreviewDefinition.build(author, plan);
    return { steps: [...plan.steps, ...preview.steps], result: preview.result };
  },
});
