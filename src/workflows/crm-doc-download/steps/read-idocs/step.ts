import { CrmDownloadedPeopleSchema } from "../../../../models/systems/crm/document-tasks.js";
import { CrmDocDownloadInput } from "../../../../models/workflows/crm-doc-download/input.js";
import { defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { readCrmDocumentPdfs } from "../../tasks/read-idocs.js";
import { buildSearchRecords } from "../search-records/step.js";

const group = Object.freeze({ ...defineWorkflowStep({ key: "read-idocs", label: "Download CRM documents" }), system: "crm" as const });

export function buildReadIdocs(author: WorkflowAuthor<typeof CrmDocDownloadInput>, search: ReturnType<typeof buildSearchRecords>) {
  const call = readCrmDocumentPdfs(group);
  const documents = author.task(call.identity, [search.records], ({ outputs }) => call.bind({ input: outputs["document-records"] }));
  return { documents, steps: [[group, [documents]]] as const,
    result: author.result(CrmDownloadedPeopleSchema, [documents], ({ outputs }) => outputs["document-pdfs"]) };
}

export const crmDocumentReadIdocsDefinition = defineStep({
  group, build: buildReadIdocs,
  nodePurposes: [{ nodeId: "document-pdfs", purpose: "Reopen and verify each selected CRM identity, download its selected PDFs and retain verified bytes." }],
  proof: { id: "crm-doc-download-read-idocs", order: 20,
    build: (parent: WorkflowDefinition<typeof CrmDocDownloadInput>) => ({
      ...inheritStepProof(parent), code: "cdd", label: group.label, summary: "Proves identity-bound iDocs downloads and retained PDF artifacts for the batch.",
      steps: (author: WorkflowAuthor<typeof CrmDocDownloadInput>) => {
        const search = buildSearchRecords(author), downloaded = buildReadIdocs(author, search);
        return { steps: [...search.steps, ...downloaded.steps], result: downloaded.result };
      },
    }),
  },
});
