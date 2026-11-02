import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { WorkbookIdSchema } from "../../dashboard/workbooks.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";

const text = z.string().min(1);
export const WorkbookTableSchema = z.strictObject({
  name: text, columns: z.array(text).min(1),
  rows: z.array(z.strictObject({ id: text, values: z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])) })).min(1),
}).superRefine((table, ctx) => {
  if (new Set(table.rows.map(row => row.id)).size !== table.rows.length
    || table.rows.some(row => row.values.length !== table.columns.length)
    || (table.rows.length + 1) * table.columns.length > 100_000) ctx.addIssue({ code: "custom", message: "Invalid table row identity, width, or cell count" });
});
export const WorkflowWorkbookCommandSchema = z.strictObject({
  operationKey: text,
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("create"), name: text }),
    z.strictObject({ kind: z.literal("append"), libraryId: WorkbookIdSchema, expectedVersion: z.number().int().positive(), sheetId: text }),
    z.strictObject({ kind: z.literal("replace"), libraryId: WorkbookIdSchema, expectedVersion: z.number().int().positive() }),
  ]),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("table"), table: WorkbookTableSchema }),
    z.strictObject({ kind: z.literal("xlsx"), name: text.regex(/\.xlsx$/iu), artifact: ArtifactRefSchema }),
  ]),
}).refine(command => command.target.kind !== "append" || command.source.kind === "table", "Append needs table rows")
  .refine(command => command.target.kind !== "replace" || command.source.kind === "xlsx", "A linked replacement needs an XLSX artifact");
export type WorkflowWorkbookCommand = z.output<typeof WorkflowWorkbookCommandSchema>;
export const WorkflowWorkbookResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("saved"), operationId: text, libraryId: WorkbookIdSchema, version: z.number().int().positive() }),
  z.strictObject({ state: z.literal("refused"), code: z.enum(["WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_VERSION_CONFLICT", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED"]), message: text }),
]);
export const ReadWorkbookResult = defineTaskContract({
  id: taskId("workbooks/read-result"), title: "Save workflow workbook", effect: "read",
  input: WorkflowWorkbookCommandSchema, output: WorkflowWorkbookResultSchema,
  errorCodes: ["WORKBOOK_PROVIDER_UNAVAILABLE", "WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_VERSION_CONFLICT", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED"], providers: ["workbooks.library"],
  subject: { kind: "none", reason: "Publishes a derived local workbook through the admitted library provider" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
  scenarios: ["workbooks/publish"],
  example: { state: "saved", operationId: "example-operation", libraryId: "example-library", version: 1 },
});
