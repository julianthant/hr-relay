import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { I9CheckStartInput, I9CheckStartCanonicalInput, I9_CHECK_REFERENCE, i9CheckStartMatchKey } from "../../models/workflows/i9-check/start.js";
import { usesOcrProvider } from "../../models/workflows/ocr/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { PositiveIntSchema } from "../../rules/identity/ids.js";
import { EMPLOYEE_REFERENCE_CHECK } from "../../models/processing/workbooks/reference-fields.js";
import { i9CheckStartDocumentsDefinition } from "./steps/documents/step.js";
import { i9CheckStartRosterReferenceDefinition } from "./steps/roster-reference/step.js";
import { i9CheckStartRetentionDefinition } from "./steps/retention/step.js";

export const i9CheckStartWorkflow = defineWorkflow({
  id: "i9-check-start", requiredWorkbookFields: [...I9_CHECK_REFERENCE.fields], workbookReference: { id: I9_CHECK_REFERENCE.typeId, keyFieldId: "eid", mode: "keys", writableFields: [] }, workbookCheck: EMPLOYEE_REFERENCE_CHECK, version: 1, code: "ip",
  label: "I-9 Check", icon: "ClipboardCheck", category: "separation",
  summary: "Reads attached I-9 PDFs, reviews their people, checks retention in UCPath and saves one results workbook with a row per approved person.",
  input: I9CheckStartInput, canonicalInput: I9CheckStartCanonicalInput, inputSubject: "document",
  identity: { matchKey: i9CheckStartMatchKey },
  referenceKeys: () => [],
  requiresOcrProvider: (input, omissions) => !omissions?.some(entry => entry.workflow === undefined && entry.step === "documents")
    && input.documents.some(usesOcrProvider),
  plannedOutputs: (_input, _references, omittedSteps = []) => omittedSteps.includes("publication") ? []
    : [{ kind: "workbook", name: "I-9 Check results", rowSubject: "person", rows: { state: "after-review" } }],
  presentation: { title: ({ documents }) => documents.length === 1 && documents[0] !== undefined ? documents[0].fileName : `I-9 Check · ${documents.length} PDFs`, subtitle: () => "One results workbook" },
  surface: { shape: "single" }, surfaces: {
    uploadRun: { title: { segments: [{ kind: "literal", text: "I-9 PDFs" }] }, fields: [],
      pdfInput: { documentsField: "documents", asOfField: "asOf", reviewerField: "reviewerName" },
      ocrStep: "documents",
      accepts: [{ mediaType: "application/pdf", extensions: [".pdf"], maxBytes: PositiveIntSchema.parse(25 * 1024 * 1024) }],
      successMessage: { segments: [{ kind: "literal", text: "PDFs attached for one I-9 Check run." }] } },
  },
  enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, role: defineWorkflowRole({ kind: "composition" }),
  scenarios: ["i9-check-start/pdfs"], details: [
    { key: "people", label: "People", source: { nodeId: "read-rows", fieldPath: "personCount" }, display: "text" },
    { key: "reference", label: "Reference version", source: { nodeId: "read-rows", fieldPath: "reference.snapshot.versionName" }, display: "text" },
  ],
  nodePurposes: [...i9CheckStartDocumentsDefinition.nodePurposes, ...i9CheckStartRosterReferenceDefinition.nodePurposes, ...i9CheckStartRetentionDefinition.nodePurposes],
  artifactProjections: [{ id: "i9-check-tracker", source: { nodeId: "publish-results", fieldPath: "tracker" }, keyFields: ["batchKey"], sink: "xlsx-retention", blocking: true }],
  rows: [
    { key: "documents", label: "Read and approve PDFs", members: [{ step: "documents" }], target: { step: "documents" } },
    { key: "ocr-source-pages", label: "Prepare source pages", members: [{ workflow: "ocr", step: "source-pages" }], target: { workflow: "ocr", step: "source-pages" } },
    { key: "read-forms", label: "Read I-9 forms", members: [{ workflow: "ocr", step: "page-readings" }], target: { workflow: "ocr", step: "page-readings" } },
    { key: "ocr-group-records", label: "Group records for review", members: [{ workflow: "ocr", step: "review-records" }], target: { workflow: "ocr", step: "review-records" } },
    { key: "match-people", label: "Match extracted people", members: [{ workflow: "ocr", step: "identity-lookups" }], target: { workflow: "ocr", step: "identity-lookups" } },
    { key: "ocr-signer-lookups", label: "Look up official signers", members: [{ workflow: "ocr", step: "signer-lookups" }], target: { workflow: "ocr", step: "signer-lookups" } },
    { key: "review-records", label: "Review extracted records", members: [{ workflow: "ocr", step: "approval" }], target: { workflow: "ocr", step: "approval" } },
    { key: "roster-reference", label: "Read Action History", members: [{ step: "roster-reference" }], target: { step: "roster-reference" } },
    { key: "ucpath-match", label: "Match person in UCPath", members: [{ workflow: "i9-check", step: "person-match" },
      { workflow: "i9-check", step: "reference-check" }], target: { workflow: "i9-check", step: "person-match" } },
    { key: "ucpath-dates", label: "Read employment dates", members: [{ workflow: "i9-check", step: "person-lookup" }], target: { workflow: "i9-check", step: "person-lookup" } },
    { key: "retention", label: "Collect retention results", members: [{ workflow: "i9-check", step: "roster-match" }, { step: "retention" }], target: { step: "retention" } },
    { key: "tracker-row", label: "Append retention tracker row", members: [{ step: "publication" }], target: { step: "publication" } },
  ],
  steps: author => {
    const documents = i9CheckStartDocumentsDefinition.build(author), reference = i9CheckStartRosterReferenceDefinition.build(author, documents);
    const retention = i9CheckStartRetentionDefinition.build(author, reference);
    return { steps: [...documents.steps, ...reference.steps, ...retention.steps], result: retention.result };
  },
});
