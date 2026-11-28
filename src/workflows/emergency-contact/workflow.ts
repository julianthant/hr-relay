import { emergencyContactReadDocumentDefinition } from "./steps/read-document/step.js";
import { emergencyContactMembersDefinition } from "./steps/members/step.js";
import { EmergencyContactInputSchema, EmergencyContactCanonicalInput } from "../../models/workflows/emergency-contact/input.js";
import { OCR_ROSTER_TYPE_ID, OCR_ROSTER_FIELDS } from "../../models/workflows/ocr/roster.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { PositiveIntSchema } from "../../rules/identity/ids.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { EMERGENCY_CONTACT_SCENARIOS } from "../emergency-contact-member/workflow.js";
import { EMPLOYEE_REFERENCE_CHECK } from "../../models/processing/workbooks/reference-fields.js";
import { WORKSHEET_ROW_CHOICE_GATE } from "../../models/processing/workbooks/reference-choice.js";
import { usesOcrProvider } from "../../models/workflows/ocr/input.js";

const UNNAMED_PDF_TITLE = "Emergency Contact PDF";

export const emergencyContactWorkflow = defineWorkflow({
  id: "emergency-contact", version: 2, code: "ec", label: "Emergency Contact", icon: "Users", category: "documents",
  summary: "Reads and releases a PDF, then delegates exactly its approved records for primary contact previews.",
  requiredWorkbookFields: [...OCR_ROSTER_FIELDS], workbookReference: { id: OCR_ROSTER_TYPE_ID, keyFieldId: "eid", mode: "all", writableFields: [] }, workbookCheck: EMPLOYEE_REFERENCE_CHECK, input: EmergencyContactInputSchema, canonicalInput: EmergencyContactCanonicalInput,
  inputSubject: "document", surface: { shape: "operation" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  requiresOcrProvider: usesOcrProvider,
  capabilities: { review: false, editData: false, singleAcquisitionPerSystemPerClaim: true },
  surfaces: { uploadRun: { title: { segments: [{ kind: "literal", text: "Emergency Contact PDFs" }] },
    fields: [{ kind: "select", field: "onbaseFiling", label: "File to OnBase", required: true, options: [{ value: "file", label: "File" }, { value: "skip", label: "Do not file" }] },
      { kind: "boolean", field: "extractWithOcr", label: "Extract with OCR", description: "Turn off to enter records manually in OCR review.", initial: true }],
    pdfInput: { documentField: "document", fileNameField: "fileName", readingIdField: "readingId", fixed: { roster: null, reading: { kind: "subscription" } } },
    accepts: [{ mediaType: "application/pdf", extensions: [".pdf"], maxBytes: PositiveIntSchema.parse(25 * 1024 * 1024) }],
    successMessage: { segments: [{ kind: "literal", text: "PDFs attached for Emergency Contact runs." }] } } }, details: [], role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => `${input.document.sha256}:${input.readingId}` },
  presentation: { title: input => input.fileName ?? UNNAMED_PDF_TITLE, subtitle: () => "Approved PDF records" },
  scenarios: EMERGENCY_CONTACT_SCENARIOS,
  nodePurposes: [
    { nodeId: WORKSHEET_ROW_CHOICE_GATE, purpose: "Wait for the operator to select a retained row for each conflicting roster employee." },
    { nodeId: "read-document", purpose: "Await the direct OCR child and its operator release before any contact acquisition." },
    { nodeId: "approved-records", purpose: "Read the immutable current approved snapshot through authenticated child lineage." },
    { nodeId: "read-result", purpose: "Retain the exact released reference and settled member outcomes in a schema-owned result." },
    { nodeId: "members", purpose: "Delegate the exact approved record order to Emergency Contact members." },
  ],
  rows: [
    { key: "ocr-source-pages", label: "Prepare source pages", members: [{ workflow: "ocr", step: "source-pages" }], target: { workflow: "ocr", step: "source-pages" } },
    { key: "read-emergency-contact", label: "Read emergency contact", members: [{ step: "read-document", nodes: [WORKSHEET_ROW_CHOICE_GATE, "read-document"] },
      { workflow: "ocr", step: "page-readings" }], target: { workflow: "ocr", step: "page-readings" } },
    { key: "ocr-group-records", label: "Group records for review", members: [{ workflow: "ocr", step: "review-records" }], target: { workflow: "ocr", step: "review-records" } },
    { key: "match-extracted-people", label: "Match extracted people", members: [{ step: "read-document", nodes: ["approved-records"] },
      { workflow: "ocr", step: "identity-lookups" }], target: { workflow: "ocr", step: "identity-lookups" } },
    { key: "ocr-signer-lookups", label: "Look up official signers", members: [{ workflow: "ocr", step: "signer-lookups" }], target: { workflow: "ocr", step: "signer-lookups" } },
    { key: "review-extracted-records", label: "Review extracted records", members: [{ workflow: "ocr", step: "approval" }], target: { workflow: "ocr", step: "approval" } },
    { key: "read-existing-contacts", label: "Read existing contacts", members: [{ workflow: "emergency-contact-member", step: "contact-plan" },
      { workflow: "emergency-contact-member", step: "reference-check" }] },
    { key: "fill-emergency-contact", label: "Fill emergency contact", members: [{ workflow: "emergency-contact-member", step: "contact-preview", phase: "prepare" }] },
    { key: "save-emergency-contact", label: "Save emergency contact", members: [{ workflow: "emergency-contact-member", step: "contact-preview", phase: "commit" },
      { workflow: "emergency-contact-member", step: "onbase-filing" }, { step: "members" }] },
  ],
  steps: author => {
    const records = emergencyContactReadDocumentDefinition.build(author), members = emergencyContactMembersDefinition.build(author, records);
    return { steps: [...records.steps, ...members.steps], result: members.result };
  },
});
