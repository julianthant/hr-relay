import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId, FingerprintSchema } from "../../../rules/identity/ids.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { ReadRetentionRow } from "../i9-check/read-retention-row.js";
import { ReadI9CheckRequests } from "./read-requests.js";
import { I9_CHECK_BATCH_TASK_POLICY, I9_CHECK_BATCH_ROWS_EXAMPLE, I9CheckBatchRowsSchema } from "../i9-check/batch.js";

export const ReadI9CheckRows = defineTaskContract({
  ...I9_CHECK_BATCH_TASK_POLICY, id: taskId("workflow:i9-check-start/read-rows"), title: "Collect one retention row per person",
  input: z.strictObject({ batchKey: FingerprintSchema, prepared: ReadI9CheckRequests.output, outcomes: z.array(childRunOutcomeSchema(ReadRetentionRow.output)).min(1) }),
  output: I9CheckBatchRowsSchema, example: I9_CHECK_BATCH_ROWS_EXAMPLE,
});
