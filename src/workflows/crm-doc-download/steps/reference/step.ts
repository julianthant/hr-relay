import { CrmDocDownloadInput } from "../../../../models/workflows/crm-doc-download/input.js";
import { ReadCrmDocumentRows, CrmDocumentReferenceSourceSchema, CrmDocumentRowsSchema, CrmDocumentRowChoiceSchema, CRM_DOCUMENT_ROW_CHOICE_GATE_ID } from "../../../../models/workflows/crm-doc-download/read-document-rows.js";
import { decodeWorkbookReference } from "../../../../models/processing/workbooks/read-reference.js";
import { defineStep, defineStepEntries, reuseTask, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import type { z } from "zod";
import { ReadWorkbookReference } from "../../../../models/processing/workbooks/read-reference.js";
import { CrmDocumentRecordsSchema } from "../../../../models/systems/crm/documents.js";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../../../models/workflows/onboarding/roster.js";
import { crmDocumentReferenceKeys } from "../../../../rules/crm-doc-download/reference.js";
import { buildSearchRecords } from "../search-records/step.js";

const group = Object.freeze({
  ...defineWorkflowStep({ key: "reference", label: "Resolve worksheet rows" }), system: "local",
  operatorFields: [
    { label: "Reference version", sources: [{ nodeId: "workbook-reference", kind: "output", fieldPath: "reference.snapshot.versionName" }] },
    { label: "Row resolution", sources: [{ nodeId: "document-rows", kind: "output", fieldPath: "people.resolution.state" }] },
    { label: "Worksheet", sources: [{ nodeId: "document-rows", kind: "output", fieldPath: "people.resolution.selected.row.worksheetName" }] },
  ],
  review: {
    pages: [
      {
        id: "saved-roster",
        title: "Saved roster",
        mode: "Read only",
        nodeIds: ["workbook-reference", "document-rows", "document-row-choice"],
        lines: [
          { id: "reference", kind: "read", text: "Read the roster version captured for this run.", nodeIds: ["workbook-reference"] },
          { id: "rows", kind: "check", text: "Match verified CRM identities to legal and lived names in the saved worksheet rows.", nodeIds: ["document-rows"] }
        ],
        fields: [
          {
            id: "reference-version",
            operatorField: "Reference version",
            source: {
              origin: "Saved roster",
              detail: "The exact version captured for this run.",
              chain: [],
              read: { stepKey: "reference", page: "Saved roster", field: "Reference version" }
            }
          },
          {
            id: "row-resolution",
            operatorField: "Row resolution",
            source: {
              origin: "Saved roster",
              detail: "Whether the verified identity identifies one worksheet row or needs an operator choice.",
              chain: [],
              read: { stepKey: "reference", page: "Saved roster", field: "Row resolution" }
            }
          },
          {
            id: "worksheet",
            operatorField: "Worksheet",
            source: {
              origin: "Saved roster",
              detail: "The worksheet selected for the verified person.",
              chain: [],
              read: { stepKey: "reference", page: "Saved roster", field: "Worksheet" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} as const);
const entries = defineStepEntries(group);

export function buildReference(author: WorkflowAuthor<typeof CrmDocDownloadInput>, search: ReturnType<typeof buildSearchRecords>) {
  const call = reuseTask(group, { id: "workbook-reference", contract: ReadWorkbookReference, replay: "checkpoint" },
    (input: z.output<typeof CrmDocumentRecordsSchema>) => ({ typeId: ONBOARDING_ROSTER_TYPE_ID, keys: crmDocumentReferenceKeys(input) }));
  const reference = author.task(call.identity, [search.records], ({ outputs }) => call.bind({ input: outputs["document-records"] }));
  const rows = author.task(entries.task("document-rows", ReadCrmDocumentRows, { replay: "checkpoint" }), [search.records, reference], ({ outputs }) => ({
    records: outputs["document-records"],
    sources: outputs["workbook-reference"].sources.map(source => CrmDocumentReferenceSourceSchema.parse({
      referenceDigest: source.referenceDigest, reference: decodeWorkbookReference(source.reference),
    })),
  }));
  const choice = author.gate({ ...entries.operatorGate(CRM_DOCUMENT_ROW_CHOICE_GATE_ID, { label: "Choose worksheet rows", result: CrmDocumentRowChoiceSchema }),
    when: { kind: "equals", of: { from: "node", nodeId: "document-rows", path: "state" }, value: "resolve-required" },
  }, [rows]);
  return { reference, rows, choice, steps: [[group, [reference, rows, choice]]] as const,
    result: author.result(CrmDocumentRowsSchema, [rows, choice], ({ outputs }) => {
      const selected = outputs[CRM_DOCUMENT_ROW_CHOICE_GATE_ID] ?? outputs["document-rows"];
      return CrmDocumentRowsSchema.parse({ referenceDigest: selected.referenceDigest, sourceDigests: selected.sourceDigests,
        state: selected.state, people: selected.people });
    }) };
}

export const crmDocumentReferenceDefinition = defineStep({
  group, build: buildReference,
  nodePurposes: [
    { nodeId: "workbook-reference", purpose: "Read newly verified CRM email keys from the run's exact retained spreadsheet version." },
    { nodeId: "document-rows", purpose: "Bind verified identities to retained worksheet rows and legal/lived names without choosing ambiguous matches." },
    { nodeId: CRM_DOCUMENT_ROW_CHOICE_GATE_ID, purpose: "Hold missing or ambiguous worksheet membership for authenticated operator choices." },
  ],
  proof: { id: "crm-doc-download-reference", order: 22,
    build: (parent: WorkflowDefinition<typeof CrmDocDownloadInput>) => ({
      ...inheritStepProof(parent), code: "cdr", label: group.label, summary: "Proves run-bound reference reads and explicit worksheet row resolution.",
      steps: (author: WorkflowAuthor<typeof CrmDocDownloadInput>) => {
        const search = buildSearchRecords(author), reference = buildReference(author, search);
        return { steps: [...search.steps, ...reference.steps], result: reference.result };
      },
    }),
  },
});
