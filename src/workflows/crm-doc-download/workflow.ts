import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { CrmDocDownloadInput, CrmDocDownloadCanonicalInput, CRM_DOCUMENT_INPUT_PARSER } from "../../models/workflows/crm-doc-download/input.js";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../models/workflows/onboarding/roster.js";
import { CRM_DOCUMENT_ROSTER_FIELDS } from "../../models/workflows/crm-doc-download/documents.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { crmDocumentSearchRecordsDefinition } from "./steps/search-records/step.js";
import { crmDocumentReferenceDefinition } from "./steps/reference/step.js";
import { crmDocumentReadIdocsDefinition } from "./steps/read-idocs/step.js";
import { crmDocumentPackageWorksheetsDefinition } from "./steps/package-worksheets/step.js";

export const crmDocDownloadWorkflow = defineWorkflow({
  id: "crm-doc-download", version: 1, code: "cd", label: "CRM Document Download", icon: "FileText", category: "documents",
  summary: "Download verified CRM PDFs and package one archive in each person's worksheet folder using the selected spreadsheet version's legal and lived names.",
  requiredWorkbookFields: [...CRM_DOCUMENT_ROSTER_FIELDS],
  workbookReference: { id: ONBOARDING_ROSTER_TYPE_ID, keyFieldId: "email", mode: "keys", writableFields: [] },
  referenceKeys: input => input.people.flatMap(person => person.kind === "email" ? [person.value] : []),
  plannedOutputs: () => [{ kind: "worksheet-archives", state: "after-row-choice" }],
  input: CrmDocDownloadInput, canonicalInput: CrmDocDownloadCanonicalInput, inputSubject: "none",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["crm-doc-download/worksheet-archives"],
  identity: { matchKey: input => canonicalJsonStringify(input.people.map(person => `${person.kind}:${person.value}`).sort()) },
  presentation: { title: input => `${String(input.people.length)} people`, subtitle: () => "Worksheet document archives" },
  surfaces: { inputRun: { placeholder: "Enter employee IDs or emails for one batch", parser: CRM_DOCUMENT_INPUT_PARSER,
    examples: [{ key: "email-batch", label: "Two people", text: "fixture@example.test; second@example.test", note: "Starts one batch for both people" }] } },
  details: [
    { key: "worksheets", label: "Worksheet archives", source: { kind: "result", fieldPath: "worksheetCount" }, display: "text" },
    { key: "people", label: "People", source: { kind: "result", fieldPath: "personCount" }, display: "text" },
    { key: "documents", label: "PDF documents", source: { kind: "result", fieldPath: "documentCount" }, display: "text" },
  ], verdicts: [],
  artifactProjections: [{ id: "worksheet-archives", source: { nodeId: "worksheet-archives", fieldPath: "collection" },
    keyFields: ["collection.artifact.sha256"], sink: "documents-file", blocking: true }],
  nodePurposes: [...crmDocumentSearchRecordsDefinition.nodePurposes, ...crmDocumentReferenceDefinition.nodePurposes,
    ...crmDocumentReadIdocsDefinition.nodePurposes, ...crmDocumentPackageWorksheetsDefinition.nodePurposes],
  steps: author => {
    const search = crmDocumentSearchRecordsDefinition.build(author);
    const reference = crmDocumentReferenceDefinition.build(author, search);
    const downloaded = crmDocumentReadIdocsDefinition.build(author, search, reference);
    const packaged = crmDocumentPackageWorksheetsDefinition.build(author, downloaded, reference);
    return { steps: [...search.steps, ...reference.steps, ...downloaded.steps, ...packaged.steps], result: packaged.result };
  },
});
