import { z } from "zod";
import { WorkbookIdSchema, WorkbookCellValuesSchema } from "../../dashboard/workbooks.js";
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
export const WorkbookReferenceWriteSchema = z.strictObject({ kind: z.literal("patch-reference"),
  writeId: z.string().regex(/^[a-z][a-z\d-]{0,79}$/u), typeId: WorkbookIdSchema, key: z.string().min(1),
  values: z.array(z.strictObject({ fieldId: WorkbookCellValuesSchema.keyType, value: WorkbookCellValuesSchema.valueType })).min(1)
    .refine(values => new Set(values.map(cell => cell.fieldId)).size === values.length, "Workbook fields must be unique") });
export const WorkflowWorkbookCommandSchema = z.union([z.strictObject({ name: text, table: WorkbookTableSchema }), WorkbookReferenceWriteSchema]);
export type WorkflowWorkbookCommand = z.output<typeof WorkflowWorkbookCommandSchema>;
export const WorkflowWorkbookResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("saved"), operationId: text, libraryId: WorkbookIdSchema, version: z.number().int().positive() }),
  z.strictObject({ state: z.literal("recorded"), operationId: text, libraryId: WorkbookIdSchema, version: z.number().int().positive(),
    receiptState: z.enum(["applied", "resolve-required", "refused"]) }),
  z.strictObject({ state: z.literal("refused"), code: z.enum(["WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_VERSION_CONFLICT", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED", "WORKBOOK_OPERATION_CONFLICT", "WORKBOOK_METADATA_UNSUPPORTED", "WORKBOOK_REVISION_UNAVAILABLE"]), message: text }),
]);
export const ReadWorkbookResult = defineTaskContract({
  id: taskId("workbooks/read-result"), title: "Save workflow workbook", effect: "read",
  input: WorkflowWorkbookCommandSchema, output: WorkflowWorkbookResultSchema,
  errorCodes: ["WORKBOOK_PROVIDER_UNAVAILABLE", "WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_VERSION_CONFLICT", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED", "WORKBOOK_OPERATION_CONFLICT", "WORKBOOK_METADATA_UNSUPPORTED", "WORKBOOK_REVISION_UNAVAILABLE"], providers: ["workbooks.library"],
  subject: { kind: "none", reason: "Publishes a run workbook or writes through its captured reference using the admitted library provider" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["workbooks/publish"],
  example: { state: "saved", operationId: "example-operation", libraryId: "example-library", version: 1 },
});
