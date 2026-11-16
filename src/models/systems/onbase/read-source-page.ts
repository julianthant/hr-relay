import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ONBASE_EXAMPLE_TARGET, ONBASE_IMPORT_ERROR_CODES, OnbaseInputSchema, OnbaseTargetSchema } from "./import-document.js";

export const OnbaseReadSourcePage = defineTaskContract({
  id: taskId("onbase/read-source-page"), title: "Read this person's PDF page", effect: "read", input: OnbaseInputSchema, output: OnbaseTargetSchema,
  errorCodes: ONBASE_IMPORT_ERROR_CODES, subject: { kind: "none", reason: "Reads one explicitly selected local PDF page without inferring a person." },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, artifacts: "content-addressed",
  scenarios: ["onbase/one-page", "onbase/invalid-pdf"], example: ONBASE_EXAMPLE_TARGET,
});
