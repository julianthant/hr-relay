import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ONBASE_EXAMPLE_PREPARED, ONBASE_IMPORT_ERROR_CODES, ONBASE_IMPORT_SUBJECT, OnbasePreparedSchema, OnbaseTargetSchema } from "./import-document.js";

export const OnbasePrepareImport = defineTaskContract({
  id: taskId("onbase/stage-import"), title: "Prepare Emergency Contact import", effect: "prepare", input: OnbaseTargetSchema, output: OnbasePreparedSchema,
  errorCodes: ONBASE_IMPORT_ERROR_CODES, subject: ONBASE_IMPORT_SUBJECT, checkpoint: "in-memory-only", scenarios: ["onbase/prepare", "onbase/keyset-miss", "onbase/identity-mismatch"],
  example: ONBASE_EXAMPLE_PREPARED,
});
