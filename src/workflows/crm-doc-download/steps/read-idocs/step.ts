import { CrmDownloadedPeopleSchema } from "../../../../models/systems/crm/document-tasks.js";
import { CrmDocDownloadInput } from "../../../../models/workflows/crm-doc-download/input.js";
import { defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { readCrmDocumentPdfs } from "../../tasks/read-idocs.js";
import { buildSearchRecords } from "../search-records/step.js";
import type { buildReference } from "../reference/step.js";

const group = Object.freeze({
  ...defineWorkflowStep({ key: "read-idocs", label: "Download CRM documents" }), system: "crm",
  operatorFields: [
    { label: "Employee ID", sources: [{ nodeId: "document-pdfs", kind: "output", fieldPath: "people.identity.eid" }] },
    { label: "Available documents", sources: [{ nodeId: "document-pdfs", kind: "output", fieldPath: "people.totalDocuments" }] },
    { label: "Downloaded PDF", sources: [{ nodeId: "document-pdfs", kind: "output", fieldPath: "people.documents.fileName" }] },
  ],
} as const);

export function buildReadIdocs(author: WorkflowAuthor<typeof CrmDocDownloadInput>, search: ReturnType<typeof buildSearchRecords>, reference?: ReturnType<typeof buildReference>) {
  const call = readCrmDocumentPdfs(group);
  const dependencies = reference === undefined ? [search.records] as const : [search.records, reference.choice] as const;
  const documents = author.task(call.identity, dependencies, ({ outputs }) => call.bind({ input: outputs["document-records"] }));
  return { documents, steps: [[group, [documents]]] as const,
    result: author.result(CrmDownloadedPeopleSchema, [documents], ({ outputs }) => outputs["document-pdfs"]) };
}

export const crmDocumentReadIdocsDefinition = defineStep({
  group, build: buildReadIdocs,
  nodePurposes: [{ nodeId: "document-pdfs", purpose: "Reopen and verify each selected CRM identity, download its selected PDFs and retain verified bytes." }],
  proof: { id: "crm-doc-download-read-idocs", order: 23,
    build: (parent: WorkflowDefinition<typeof CrmDocDownloadInput>) => ({
      ...inheritStepProof(parent), code: "cdd", label: group.label, summary: "Proves identity-bound iDocs downloads and retained PDF artifacts for the batch.",
      steps: (author: WorkflowAuthor<typeof CrmDocDownloadInput>) => {
        const search = buildSearchRecords(author), downloaded = buildReadIdocs(author, search);
        return { steps: [...search.steps, ...downloaded.steps], result: downloaded.result };
      },
    }),
  },
});
