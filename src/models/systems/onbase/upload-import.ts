import type { z } from "zod";
import { taskId, TaskIdSchema } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ONBASE_EXAMPLE_PROOF, ONBASE_IMPORT_ERROR_CODES, ONBASE_IMPORT_SUBJECT, OnbaseImportOutputSchema, OnbaseSavedDocumentSchema, OnbaseTargetSchema, onbaseImportKey, type OnbaseSavedDocument } from "./import-document.js";

export const OnbaseCommitImport = defineTaskContract({
  id: taskId("onbase/upload-import"), title: "Import Emergency Contact once", effect: "commit", input: OnbaseTargetSchema, output: OnbaseImportOutputSchema,
  errorCodes: ONBASE_IMPORT_ERROR_CODES, subject: ONBASE_IMPORT_SUBJECT, scenarios: ["onbase/committed", "onbase/unknown"],
  writeSafety: {
    completion: { kind: "upload-verify", verify: { taskId: TaskIdSchema.parse("onbase/verify-import"), effect: "read" }, proofSchema: OnbaseSavedDocumentSchema,
      proofFromOutput: (output: z.output<typeof OnbaseImportOutputSchema>) => output.savedDocument,
      proofFromPresentProbe: ({ proof }: { proof: OnbaseSavedDocument }) => proof, outputFromProof: (proof: OnbaseSavedDocument) => ({ savedDocument: proof }) },
    idempotency: { key: onbaseImportKey, probe: { taskId: TaskIdSchema.parse("onbase/match-import"), effect: "read" },
      recoveryAbsence: { kind: "operator-only", reason: "OnBase indexing propagation has no verified negative-settlement interval; UNKNOWN cannot authorize another Import." } },
  }, example: { savedDocument: ONBASE_EXAMPLE_PROOF },
});
