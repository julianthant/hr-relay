import { CrmDocumentRecordsSchema } from "../../../../models/systems/crm/documents.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { CrmDocDownloadCanonicalInput, CrmDocDownloadInput, type CrmDocDownloadInputValue } from "../../../../models/workflows/crm-doc-download/input.js";
import { crmManualDocumentRecordsSchema } from "../../../../models/workflows/crm-doc-download/manual-records.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import { defineStep, inheritStepProof, reuseTask, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { CrmSearchDocumentRecords } from "../../../../models/systems/crm/search-document-records.js";

export const CRM_DOCUMENT_SEARCH_MANUAL: StepManualDeclaration = {
  form: { fields: [{ key: "records", label: "CRM records", kind: "text", format: "crm-document-records",
    help: "Enter CRM record ID | Employee ID | Work email | Personal email for each person in input order. Leave unknown fields blank and separate people with semicolons." }] },
  produces: {
    "document-records": ({ facts, scope }) => crmManualDocumentRecordsSchema(
      CrmDocDownloadCanonicalInput.parse(scope.input).people,
    ).parse(facts.records),
  },
};

const group = Object.freeze({
  ...defineWorkflowStep({ key: "search-records", label: "Find latest CRM records" }), system: "crm",
  operatorFields: [
    { label: "Employee ID", example: PERSON_LOOKUP_EXAMPLE_EID, sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.eid" }] },
    { label: "Work email", sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.workEmail" }] },
    { label: "Personal email", example: "fixture.personal@example.test", sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.personalEmail" }] },
    { label: "CRM record", sources: [{ nodeId: "document-records", kind: "output", fieldPath: "records.identity.recordId" }] },
  ],
  review: {
    pages: [
      {
        id: "crm-record-search",
        title: "CRM onboarding search results",
        mode: "Read only",
        nodeIds: ["document-records"],
        lines: [{ id: "find-records", kind: "action", text: "Find each requested identity and verify the latest eligible CRM record.", nodeIds: ["document-records"] }],
        fields: [
          {
            id: "employee-id",
            operatorField: "Employee ID",
            source: {
              origin: "CRM",
              detail: "Employee ID on the selected record.",
              chain: [],
              read: { stepKey: "search-records", page: "CRM onboarding search results", field: "Employee ID" }
            }
          },
          {
            id: "work-email",
            operatorField: "Work email",
            source: {
              origin: "CRM",
              detail: "Work email on the selected record.",
              chain: [],
              read: { stepKey: "search-records", page: "CRM onboarding search results", field: "Work email" }
            }
          },
          {
            id: "personal-email",
            operatorField: "Personal email",
            source: {
              origin: "CRM",
              detail: "Personal email on the selected record.",
              chain: [],
              read: { stepKey: "search-records", page: "CRM onboarding search results", field: "Personal email" }
            }
          },
          {
            id: "crm-record",
            operatorField: "CRM record",
            source: {
              origin: "CRM",
              detail: "Selected CRM record identifier.",
              chain: [],
              read: { stepKey: "search-records", page: "CRM onboarding search results", field: "CRM record" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} as const);

export function buildSearchRecords(author: WorkflowAuthor<typeof CrmDocDownloadInput>, allowManual = true) {
  const call = reuseTask(group, { id: "document-records", contract: CrmSearchDocumentRecords, replay: "checkpoint" },
    (input: CrmDocDownloadInputValue) => ({ subjects: input.people }));
  const records = author.task(call.identity, [], call.bind);
  return { records, steps: [[allowManual ? author.group(group, { manual: CRM_DOCUMENT_SEARCH_MANUAL }) : group, [records]]] as const,
    result: author.result(CrmDocumentRecordsSchema, [records], ({ outputs }) => outputs["document-records"]) };
}

export const crmDocumentSearchRecordsDefinition = defineStep({
  group, build: buildSearchRecords,
  nodePurposes: [{ nodeId: "document-records", purpose: "Search each requested EID or email and verify the latest eligible CRM record's displayed identity." }],
  proof: { id: "crm-doc-download-search-records", order: 21,
    build: (parent: WorkflowDefinition<typeof CrmDocDownloadInput>) => ({
      ...inheritStepProof(parent), code: "cds", label: group.label, summary: "Proves exact-identity CRM record selection for the complete submitted batch.",
      steps: (author: WorkflowAuthor<typeof CrmDocDownloadInput>) => buildSearchRecords(author, false),
    }),
  },
});
