import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { WorkflowWorkbookResultSchema } from "../../processing/workbooks/read-result.js";
import { I9_CHECK_BATCH_TASK_POLICY, I9_CHECK_BATCH_ROWS_EXAMPLE, I9CheckBatchRowsSchema, I9CheckStartResultSchema } from "../i9-check/batch.js";

export const ReadI9CheckPublication = defineTaskContract({
  ...I9_CHECK_BATCH_TASK_POLICY, id: taskId("workflow:i9-check-start/read-publication"), title: "Verify the results workbook and fill the tracker",
  input: z.strictObject({ rows: I9CheckBatchRowsSchema, workbook: WorkflowWorkbookResultSchema }), output: I9CheckStartResultSchema,
  example: { ...I9_CHECK_BATCH_ROWS_EXAMPLE, workbook: { state: "saved", operationId: "example-publication", libraryId: "results-workbook", version: 1 } },
});
