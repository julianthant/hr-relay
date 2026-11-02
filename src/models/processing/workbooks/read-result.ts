import { z } from "zod";
import { WorkbookIdSchema } from "../../dashboard/workbooks.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";

const text = z.string().min(1).refine(value => value.trim().length > 0);
export const WorkbookTableSchema = z.strictObject({
  name: text, columns: z.array(text).min(1),
  rows: z.array(z.strictObject({ id: text, values: z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])) })).min(1),
}).superRefine((table, ctx) => {
  if (new Set(table.rows.map(row => row.id)).size !== table.rows.length
    || table.rows.some(row => row.values.length !== table.columns.length)
    || (table.rows.length + 1) * table.columns.length > 100_000) ctx.addIssue({ code: "custom", message: "Invalid table row identity, width, or cell count" });
});
export const WorkflowWorkbookCommandSchema = z.strictObject({ name: text, table: WorkbookTableSchema });
export type WorkflowWorkbookCommand = z.output<typeof WorkflowWorkbookCommandSchema>;
export const WorkflowWorkbookResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("saved"), operationId: text, libraryId: WorkbookIdSchema, version: z.number().int().positive() }),
  z.strictObject({ state: z.literal("refused"), code: z.enum(["WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_VERSION_CONFLICT", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED"]), message: text }),
]);
export const ReadWorkbookResult = defineTaskContract({
  id: taskId("workbooks/read-result"), title: "Save workflow workbook", effect: "read",
  input: WorkflowWorkbookCommandSchema, output: WorkflowWorkbookResultSchema,
  errorCodes: ["WORKBOOK_PROVIDER_UNAVAILABLE", "WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_VERSION_CONFLICT", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED"], providers: ["workbooks.library"],
  subject: { kind: "none", reason: "Creates a new run workbook through the admitted library provider" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["workbooks/publish"],
  example: { state: "saved", operationId: "example-operation", libraryId: "example-library", version: 1 },
});
