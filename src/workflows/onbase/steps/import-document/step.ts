import { z } from "zod";
import { OnbaseCommitImport, OnbaseInputSchema, OnbasePrepareImport, OnbaseSavedDocumentSchema } from "../../../../models/systems/onbase/import-document.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildSource } from "../source-page/step.js";

export const OnbaseResultSchema = z.strictObject({ disposition: z.enum(["committed", "already-present"]), savedDocument: OnbaseSavedDocumentSchema });
export const ONBASE_IMPORT_STEP = Object.freeze({ ...defineWorkflowStep({ key: "import-document", label: "Import Emergency Contact" }), system: "onbase" as const });
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
      ...inheritStepProof(parent), code: "b2", label: "OnBase import document", summary: "Proves staging, one fenced import and saved PDF read-back for one person.",
      steps: (author: WorkflowAuthor<typeof OnbaseInputSchema>) => {
        const source = buildSource(author), imported = buildImport(author, source);
        return { steps: [...source.steps, ...imported.steps], result: imported.result };
      },
    }),
  },
});
