import { z } from "zod";
import { OnbaseCommitImport, OnbaseInputSchema, OnbasePrepareImport, OnbaseSavedDocumentSchema } from "../../../../models/systems/onbase/import-document.js";
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
        fields: []
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
