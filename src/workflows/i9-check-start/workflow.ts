import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { I9CheckStartInput, I9CheckStartCanonicalInput, I9_CHECK_REFERENCE, i9CheckStartMatchKey } from "../../models/workflows/i9-check/start.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { PositiveIntSchema } from "../../rules/identity/ids.js";
import { i9CheckStartDocumentsDefinition } from "./steps/documents/step.js";
import { i9CheckStartRosterReferenceDefinition } from "./steps/roster-reference/step.js";
import { i9CheckStartRetentionDefinition } from "./steps/retention/step.js";

export const i9CheckStartWorkflow = defineWorkflow({
  id: "i9-check-start", requiredWorkbookFields: [...I9_CHECK_REFERENCE.fields], workbookReference: { id: I9_CHECK_REFERENCE.typeId, keyFieldId: "eid", mode: "keys", writableFields: [] }, version: 1, code: "ip",
  label: "I-9 Check", icon: "ClipboardCheck", category: "separation",
  summary: "Reads attached I-9 PDFs, reviews their people, checks retention in UCPath and saves one results workbook with a row per approved person.",
  input: I9CheckStartInput, canonicalInput: I9CheckStartCanonicalInput, inputSubject: "document",
  identity: { matchKey: i9CheckStartMatchKey },
  referenceKeys: () => [],
  plannedOutputs: () => [{ kind: "workbook", name: "I-9 Check results", rowSubject: "person", rows: { state: "after-review" } }],
  presentation: { title: ({ documents }) => documents.length === 1 && documents[0] !== undefined ? documents[0].fileName : `I-9 Check · ${documents.length} PDFs`, subtitle: () => "One results workbook" },
  surface: { shape: "single" }, surfaces: {
    uploadRun: { title: { segments: [{ kind: "literal", text: "I-9 PDFs" }] }, fields: [],
      pdfInput: { documentsField: "documents", asOfField: "asOf", reviewerField: "reviewerName" },
      accepts: [{ mediaType: "application/pdf", extensions: [".pdf"], maxBytes: PositiveIntSchema.parse(25 * 1024 * 1024) }],
      successMessage: { segments: [{ kind: "literal", text: "PDFs attached for one I-9 Check run." }] } },
  },
  enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, role: defineWorkflowRole({ kind: "composition" }),
  scenarios: ["i9-check-start/pdfs"], details: [
    { key: "people", label: "People", source: { kind: "result", fieldPath: "personCount" }, display: "text" },
    { key: "reference", label: "Reference version", source: { kind: "result", fieldPath: "reference.snapshot.versionName" }, display: "text" },
  ],
  nodePurposes: [...i9CheckStartDocumentsDefinition.nodePurposes, ...i9CheckStartRosterReferenceDefinition.nodePurposes, ...i9CheckStartRetentionDefinition.nodePurposes],
  artifactProjections: [{ id: "i9-check-tracker", source: { nodeId: "publish-results", fieldPath: "tracker" }, keyFields: ["batchKey"], sink: "xlsx-retention", blocking: true }],
  steps: author => {
    const documents = i9CheckStartDocumentsDefinition.build(author), reference = i9CheckStartRosterReferenceDefinition.build(author, documents);
    const retention = i9CheckStartRetentionDefinition.build(author, reference);
    return { steps: [...documents.steps, ...reference.steps, ...retention.steps], result: retention.result };
  },
});
