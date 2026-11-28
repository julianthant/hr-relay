import { z } from "zod";
import { ONBASE_DOCUMENT_TYPE, OnbaseInputSchema, OnbaseSavedDocumentSchema } from "../../../../models/systems/onbase/import-document.js";
import { OnbaseCommitImport } from "../../../../models/systems/onbase/upload-import.js";
import { OnbasePrepareImport } from "../../../../models/systems/onbase/stage-import.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildSource } from "../source-page/step.js";

export const OnbaseResultSchema = z.strictObject({
  disposition: z.enum(["committed", "already-present", "omitted"]),
  savedDocument: OnbaseSavedDocumentSchema.optional(),
}).refine(({ disposition, savedDocument }) => (disposition === "omitted") === (savedDocument === undefined), {
  path: ["savedDocument"], message: "A saved document is required only for a committed or already-present import.",
});
const importManual: StepManualDeclaration = {
  off: "manual",
  form: { fields: [] },
  produces: {},
  skips: ["import-document"],
  skipsGatesAndTransactions: true,
};
export const ONBASE_IMPORT_STEP = Object.freeze({ ...defineWorkflowStep({ key: "import-document", label: "Import Emergency Contact" }), system: "onbase" as const,
  manual: importManual,
  review: {
    pages: [
      {
        id: "import-document",
        title: "Import Document",
        mode: "Fill form",
        nodeIds: ["import-document"],
        lines: [
          { id: "stage-selected-page", kind: "action", text: "Stage the selected PDF page and its Emergency Contact document type.", when: [{ "import-document": ["saved", "unconfirmed", "ONBASE_IMPORT_UNPROVED", "dry-run"] }], nodeIds: ["import-document"] },
          {
            id: "check-keywords",
            kind: "check",
            text: "Confirm the selected employee and required document keywords before importing.",
            when: [{ "import-document": ["saved", "unconfirmed", "ONBASE_IMPORT_UNPROVED", "dry-run"] }],
            nodeIds: ["import-document"]
          },
          { id: "import-pdf", kind: "click", target: "Import", when: [{ "dry-run": ["false"], "import-document": ["saved", "unconfirmed", "ONBASE_IMPORT_UNPROVED"] }], nodeIds: ["import-document"] }
        ],
        fields: [
          {
            id: "import-document-employee-id",
            label: "Employee ID",
            example: "10000001",
            transactionFields: [{ nodeId: "import-document", kind: "input", fieldPath: "ucpathId" }],
            source: { origin: "Approved import request", detail: "Use the employee ID supplied to this per-person import.", chain: [] }
          },
          {
            id: "import-document-pdf-page",
            label: "PDF page",
            example: "1",
            transactionFields: [{ nodeId: "import-document", kind: "input", fieldPath: "sourcePage" }],
            source: { origin: "Approved import request", detail: "Use exactly the original PDF page selected for this person.", chain: [] }
          },
          {
            id: "import-document-source-pdf",
            label: "Source PDF",
            example: "Fictional emergency-contact.pdf",
            transactionFields: [{ nodeId: "import-document", kind: "input", fieldPath: "document.id" }],
            source: { origin: "Approved import request", detail: "Use the verified original PDF supplied to this import.", chain: [] }
          },
          {
            id: "import-document-document-type",
            label: "Document type",
            example: "Emergency Contact",
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
        when: [{ "dry-run": ["false"], "import-document": ["saved", "already-present"] }],
        title: "Document Retrieval",
        mode: "Read only",
        nodeIds: ["import-document"],
        lines: [{ id: "verify-saved-pdf", kind: "check", text: "When a saved document is available, retrieve and verify the exact PDF.", nodeIds: ["import-document"] }],
        fields: [{ id: "retrieved-employee", label: "Employee ID", example: "10000001",
          transactionFields: [{ nodeId: "import-document", kind: "input", fieldPath: "ucpathId" }],
          source: { origin: "Saved document retrieval", detail: "The retrieved document must belong to the selected employee and contain the exact original PDF page.", chain: [] } }]
      }
    ],
    branchLabels: [],
    outcomes: [
      { nodeId: "import-document", value: "ONBASE_IMPORT_UNPROVED", then: "Stops the filing for review in Logs. An uncertain import is not retried; verify the saved evidence before taking further action." },
      { nodeId: "import-document", value: "unconfirmed", then: "Holds the import for operator resolution in Logs and does not retry it.", stops: true },
    ],
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
    result: author.result(OnbaseResultSchema, [imported], ({ outputs }): z.input<typeof OnbaseResultSchema> => {
      const result = outputs["import-document"];
      return result === undefined ? { disposition: "omitted" } : { disposition: result.disposition, savedDocument: result.output.savedDocument };
    }) };
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
