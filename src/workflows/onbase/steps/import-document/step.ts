import { z } from "zod";
import { ONBASE_DOCUMENT_TYPE, OnbaseInputSchema, OnbaseSavedDocumentSchema } from "../../../../models/systems/onbase/import-document.js";
import { OnbaseCommitImport } from "../../../../models/systems/onbase/upload-import.js";
import { OnbasePrepareImport } from "../../../../models/systems/onbase/stage-import.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildSource } from "../source-page/step.js";

export const OnbaseResultSchema = z.strictObject({ disposition: z.enum(["committed", "already-present"]), savedDocument: OnbaseSavedDocumentSchema });
export const ONBASE_IMPORT_STEP = Object.freeze({ ...defineWorkflowStep({ key: "import-document", label: "Import Emergency Contact" }), system: "onbase" as const,
  review: {
    pages: [
      {
        id: "import-document",
        title: "Import Document",
        mode: "Fill form",
        nodeIds: ["import-document"],
        lines: [
          { id: "stage-selected-page", kind: "action", text: "Stage the selected PDF page and its Emergency Contact document type.", nodeIds: ["import-document"] },
          {
            id: "check-keywords",
            kind: "check",
            text: "Confirm the selected employee and required document keywords before importing.",
            nodeIds: ["import-document"]
          },
          { id: "import-pdf", kind: "action", text: "In a live run, import the selected PDF once.", nodeIds: ["import-document"] }
        ],
        fields: [
          {
            id: "import-document-employee-id",
            label: "Employee ID",
            transactionFields: [{ nodeId: "import-document", kind: "input", fieldPath: "ucpathId" }],
            source: { origin: "Approved import request", detail: "Use the employee ID supplied to this per-person import.", chain: [] }
          },
          {
            id: "import-document-pdf-page",
            label: "PDF page",
            transactionFields: [{ nodeId: "import-document", kind: "input", fieldPath: "sourcePage" }],
            source: { origin: "Approved import request", detail: "Use exactly the original PDF page selected for this person.", chain: [] }
          },
          {
            id: "import-document-source-pdf",
            label: "Source PDF",
            transactionFields: [{ nodeId: "import-document", kind: "input", fieldPath: "document.id" }],
            source: { origin: "Approved import request", detail: "Use the verified original PDF supplied to this import.", chain: [] }
          },
          {
            id: "import-document-document-type",
            label: "Document type",
            constant: { nodeIds: ["import-document"], value: ONBASE_DOCUMENT_TYPE },
            source: { origin: "Workflow rule", detail: "The import uses the registered Emergency Contact document type.", chain: [] }
          },
          {
            id: "import-document-document-name",
            label: "Document name",
            transactionFields: [{ nodeId: "import-document", kind: "output", fieldPath: "keywords.documentName" }],
            source: { origin: "Verified OnBase keyword set", detail: "Use the keyword values resolved and checked for the selected employee before import.", chain: [] }
          },
          {
            id: "import-document-last-name",
            label: "Last name",
            transactionFields: [{ nodeId: "import-document", kind: "output", fieldPath: "keywords.lastName" }],
            source: { origin: "Verified OnBase keyword set", detail: "Use the keyword values resolved and checked for the selected employee before import.", chain: [] }
          },
          {
            id: "import-document-first-name",
            label: "First name",
            transactionFields: [{ nodeId: "import-document", kind: "output", fieldPath: "keywords.firstName" }],
            source: { origin: "Verified OnBase keyword set", detail: "Use the keyword values resolved and checked for the selected employee before import.", chain: [] }
          },
          {
            id: "import-document-department",
            label: "Department",
            transactionFields: [{ nodeId: "import-document", kind: "output", fieldPath: "keywords.departmentName" }],
            source: { origin: "Verified OnBase keyword set", detail: "Use the keyword values resolved and checked for the selected employee before import.", chain: [] }
          },
          {
            id: "import-document-department-code",
            label: "Department code",
            transactionFields: [{ nodeId: "import-document", kind: "output", fieldPath: "keywords.departmentCode" }],
            source: { origin: "Verified OnBase keyword set", detail: "Use the keyword values resolved and checked for the selected employee before import.", chain: [] }
          },
          {
            id: "import-document-vice-chancellor",
            label: "Vice chancellor",
            transactionFields: [{ nodeId: "import-document", kind: "output", fieldPath: "keywords.viceChancellor" }],
            source: { origin: "Verified OnBase keyword set", detail: "Use the keyword values resolved and checked for the selected employee before import.", chain: [] }
          },
          {
            id: "import-document-vice-chancellor-code",
            label: "Vice chancellor code",
            transactionFields: [{ nodeId: "import-document", kind: "output", fieldPath: "keywords.viceChancellorCode" }],
            source: { origin: "Verified OnBase keyword set", detail: "Use the keyword values resolved and checked for the selected employee before import.", chain: [] }
          }
        ]
      },
      {
        id: "document-retrieval",
        title: "Document Retrieval",
        mode: "Read only",
        nodeIds: ["import-document"],
        lines: [{ id: "verify-saved-pdf", kind: "check", text: "When a saved document is available, retrieve and verify the exact PDF.", nodeIds: ["import-document"] }],
        fields: []
      }
    ],
    branchLabels: []
  } as const,
});
const entry = defineStepEntries(ONBASE_IMPORT_STEP).transaction("import-document", {
  label: "Import Emergency Contact",
  prepare: OnbasePrepareImport, commit: OnbaseCommitImport, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 45_000,
});
export function buildImport(author: WorkflowAuthor<typeof OnbaseInputSchema>, upstream: ReturnType<typeof buildSource>) {
  const imported = author.transaction(entry, [upstream.source], {
    prepareBind: ({ outputs }) => outputs["source-page"], commitBind: ({ outputs }) => outputs["source-page"],
  });
  return { steps: [[ONBASE_IMPORT_STEP, [imported]]] as const,
    result: author.result(OnbaseResultSchema, [imported], ({ outputs }) => ({ disposition: outputs["import-document"].disposition,
      savedDocument: outputs["import-document"].output.savedDocument })) };
}
export const onbaseImportDocumentDefinition = defineStep({
  group: ONBASE_IMPORT_STEP, build: buildImport,
  proof: { id: "onbase-import-document", order: 14,
    build: (parent: WorkflowDefinition<typeof OnbaseInputSchema, typeof OnbaseResultSchema>) => ({
      ...inheritStepProof(parent), code: "obi", label: "OnBase import document", summary: "Proves staging, one fenced import and saved PDF read-back for one person.",
      steps: (author: WorkflowAuthor<typeof OnbaseInputSchema>) => {
        const source = buildSource(author), imported = buildImport(author, source);
        return { steps: [...source.steps, ...imported.steps], result: imported.result };
      },
    }),
  },
});
