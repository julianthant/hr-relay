import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ONBASE_EXAMPLE_PROOF, ONBASE_IMPORT_ERROR_CODES, OnbaseImportVerdictSchema, OnbaseTargetSchema } from "./import-document.js";

export const OnbaseMatchImport = defineTaskContract({
  id: taskId("onbase/match-import"), title: "Find the exact saved PDF", effect: "read", input: OnbaseTargetSchema, output: OnbaseImportVerdictSchema,
  errorCodes: ONBASE_IMPORT_ERROR_CODES, subject: { kind: "none", reason: "Exact document type and employee keyword filters are verified before accepting any retrieved PDF." },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: ["onbase/saved-effect", "onbase/unknown"],
  example: { state: "present", proof: ONBASE_EXAMPLE_PROOF },
});
