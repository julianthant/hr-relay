import { defineWorkflow, type WorkflowTimelineTuple } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import type { StepManualDeclaration } from "../../models/workflow/step-omission.js";
import { CrmDocDownloadInput, CrmDocDownloadCanonicalInput, CRM_DOCUMENT_INPUT_PARSER } from "../../models/workflows/crm-doc-download/input.js";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../models/workflows/onboarding/roster.js";
import { CRM_DOCUMENT_ROSTER_FIELDS } from "../../models/workflows/crm-doc-download/documents.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { CRM_DOCUMENT_SEARCH_MANUAL, crmDocumentSearchRecordsDefinition } from "./steps/search-records/step.js";
import { CRM_DOCUMENT_REFERENCE_MANUAL, crmDocumentReferenceDefinition } from "./steps/reference/step.js";
import { CRM_DOCUMENT_READ_IDOCS_MANUAL, crmDocumentReadIdocsDefinition } from "./steps/read-idocs/step.js";
import { CRM_DOCUMENT_PACKAGE_MANUAL, crmDocumentPackageWorksheetsDefinition } from "./steps/package-worksheets/step.js";

const packageStep = crmDocumentPackageWorksheetsDefinition.group.key;

export const crmDocDownloadWorkflow = defineWorkflow({
  id: "crm-doc-download", version: 1, code: "cd", label: "CRM Document Download", icon: "FileText", category: "documents",
  summary: "Download verified CRM PDFs and package one archive in each person's worksheet folder using the selected spreadsheet version's legal and lived names.",
  requiredWorkbookFields: [...CRM_DOCUMENT_ROSTER_FIELDS],
  workbookReference: { id: ONBOARDING_ROSTER_TYPE_ID, keyFieldId: "email", mode: "keys", writableFields: [] },
  referenceKeys: input => input.people.flatMap(person => person.kind === "email" ? [person.value] : []),
  plannedOutputs: (_input, _references, omittedSteps = []) => omittedSteps.includes(packageStep) ? [] : [{ kind: "worksheet-archives", state: "after-row-choice" }],
  input: CrmDocDownloadInput, canonicalInput: CrmDocDownloadCanonicalInput, inputSubject: "none",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["crm-doc-download/worksheet-archives"],
  identity: { matchKey: input => canonicalJsonStringify(input.people.map(person => `${person.kind}:${person.value}`).sort()) },
  presentation: { title: input => `${String(input.people.length)} people`, subtitle: () => "Worksheet document archives" },
  surfaces: { inputRun: { placeholder: "Enter employee IDs or emails for one batch", parser: CRM_DOCUMENT_INPUT_PARSER,
    examples: [{ key: "email-batch", label: "Two people", text: "fixture@example.test; second@example.test", note: "Starts one batch for both people" }] } },
  details: [
    { key: "worksheets", label: "Worksheet archives", source: { nodeId: "worksheet-archives", fieldPath: "worksheetCount" }, display: "text" },
    { key: "people", label: "People", source: { nodeId: "worksheet-archives", fieldPath: "personCount" }, display: "text" },
    { key: "documents", label: "PDF documents", source: { nodeId: "worksheet-archives", fieldPath: "documentCount" }, display: "text" },
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
    const omittable = ([group, members]: WorkflowTimelineTuple, manual: StepManualDeclaration): WorkflowTimelineTuple =>
      [author.group(group, { manual }), members];
    return {
      steps: [
        omittable(search.steps[0], CRM_DOCUMENT_SEARCH_MANUAL),
        omittable(reference.steps[0], CRM_DOCUMENT_REFERENCE_MANUAL),
        omittable(downloaded.steps[0], CRM_DOCUMENT_READ_IDOCS_MANUAL),
        omittable(packaged.steps[0], CRM_DOCUMENT_PACKAGE_MANUAL),
      ],
      result: packaged.result,
    };
  },
});
