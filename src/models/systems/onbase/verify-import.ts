import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ONBASE_IMPORT_ERROR_CODES, OnbaseImportVerdictSchema, OnbaseTargetSchema } from "./import-document.js";
import { OnbaseMatchImport } from "./match-import.js";

export const OnbaseVerifyImport = defineTaskContract({
  id: taskId("onbase/verify-import"), title: "Verify the imported PDF exists", effect: "read", input: OnbaseTargetSchema, output: OnbaseImportVerdictSchema,
  errorCodes: ONBASE_IMPORT_ERROR_CODES, subject: OnbaseMatchImport.subject, freshness: OnbaseMatchImport.freshness, provenance: OnbaseMatchImport.provenance,
  scenarios: ["onbase/saved-effect", "onbase/unknown"], example: OnbaseMatchImport.example,
});
