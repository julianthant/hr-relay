import { CrmDocumentRecordsSchema } from "../../../../models/systems/crm/document-tasks.js";
import { CrmDocDownloadInput } from "../../../../models/workflows/crm-doc-download/input.js";
import { defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { searchCrmDocumentRecords } from "../../tasks/search-records.js";

const group = Object.freeze({
  ...defineWorkflowStep({ key: "search-records", label: "Find latest CRM records" }), system: "crm",
  operatorFields: [
    { label: "Employee ID", sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.eid" }] },
    { label: "Work email", sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.workEmail" }] },
    { label: "Personal email", sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.personalEmail" }] },
    { label: "CRM record", sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.recordId" }] },
  ],
} as const);

export function buildSearchRecords(author: WorkflowAuthor<typeof CrmDocDownloadInput>) {
  const call = searchCrmDocumentRecords(group);
  const records = author.task(call.identity, [], call.bind);
  return { records, steps: [[group, [records]]] as const,
    result: author.result(CrmDocumentRecordsSchema, [records], ({ outputs }) => outputs["document-records"]) };
}

export const crmDocumentSearchRecordsDefinition = defineStep({
  group, build: buildSearchRecords,
  nodePurposes: [{ nodeId: "document-records", purpose: "Search each requested EID or email and verify the latest eligible CRM record's displayed identity." }],
  proof: { id: "crm-doc-download-search-records", order: 21,
    build: (parent: WorkflowDefinition<typeof CrmDocDownloadInput>) => ({
      ...inheritStepProof(parent), code: "cds", label: group.label, summary: "Proves exact-identity CRM record selection for the complete submitted batch.",
      steps: buildSearchRecords,
    }),
  },
});
