import { emergencyContactReadDocumentDefinition } from "./steps/read-document/step.js";
import { emergencyContactMembersDefinition } from "./steps/members/step.js";
import { EmergencyContactInputSchema, EmergencyContactCanonicalInput } from "../../models/workflows/emergency-contact/input.js";
import { OCR_ROSTER_TYPE_ID, OCR_ROSTER_FIELDS } from "../../models/workflows/ocr/roster.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { PositiveIntSchema } from "../../rules/identity/ids.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { EMERGENCY_CONTACT_SCENARIOS } from "../emergency-contact-member/workflow.js";

const UNNAMED_PDF_TITLE = "Emergency Contact PDF";

export const emergencyContactWorkflow = defineWorkflow({
  id: "emergency-contact", version: 1, code: "ec", label: "Emergency Contact", icon: "Users", category: "documents",
  summary: "Reads and releases a PDF, then delegates exactly its approved records for primary contact previews.",
  requiredWorkbookFields: [...OCR_ROSTER_FIELDS], workbookReference: { id: OCR_ROSTER_TYPE_ID, keyFieldId: "eid", mode: "all", writableFields: [] }, input: EmergencyContactInputSchema, canonicalInput: EmergencyContactCanonicalInput,
  inputSubject: "document", surface: { shape: "operation" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: { uploadRun: { title: { segments: [{ kind: "literal", text: "Emergency Contact PDFs" }] }, fields: [],
    pdfInput: { documentField: "document", fileNameField: "fileName", readingIdField: "readingId", fixed: { roster: null, reading: { kind: "subscription" } } },
    accepts: [{ mediaType: "application/pdf", extensions: [".pdf"], maxBytes: PositiveIntSchema.parse(25 * 1024 * 1024) }],
    successMessage: { segments: [{ kind: "literal", text: "PDFs attached for Emergency Contact runs." }] } } }, details: [], role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => `${input.document.sha256}:${input.readingId}` },
  presentation: { title: input => input.fileName ?? UNNAMED_PDF_TITLE, subtitle: () => "Approved PDF records" },
  scenarios: EMERGENCY_CONTACT_SCENARIOS,
  nodePurposes: [
    { nodeId: "read-document", purpose: "Await the direct OCR child and its operator release before any contact acquisition." },
    { nodeId: "approved-records", purpose: "Read the immutable current approved snapshot through authenticated child lineage." },
    { nodeId: "read-result", purpose: "Retain the exact released reference and settled member outcomes in a schema-owned result." },
    { nodeId: "members", purpose: "Delegate the exact approved record order to Emergency Contact members." },
  ],
  steps: author => {
    const records = emergencyContactReadDocumentDefinition.build(author), members = emergencyContactMembersDefinition.build(author, records);
    return { steps: [...records.steps, ...members.steps], result: members.result };
  },
});
