import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { WorkbookIdSchema, WorkbookCellValuesSchema } from "../../dashboard/workbooks.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const WorkbookReferenceReadSchema = z.strictObject({
  typeId: WorkbookIdSchema, keys: z.array(z.string().min(1)).min(1),
  fields: z.array(WorkbookCellValuesSchema.keyType).min(1),
}).refine(value => new Set(value.keys).size === value.keys.length && new Set(value.fields).size === value.fields.length,
  "Reference keys and fields must be unique");
export const WorkbookReferenceFactsSchema = z.strictObject({
  libraryId: WorkbookIdSchema, version: z.number().int().positive(), versionId: WorkbookIdSchema, versionName: z.string().min(1),
  typeId: WorkbookIdSchema, keyFieldId: WorkbookCellValuesSchema.keyType,
  worksheets: z.array(z.strictObject({ sheetId: WorkbookIdSchema, name: z.string().min(1) })).min(1),
  rows: z.array(z.strictObject({ key: z.string().min(1), state: z.enum(["matched", "missing", "ambiguous"]),
    matches: z.array(z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema,
      cells: z.array(z.strictObject({ fieldId: WorkbookCellValuesSchema.keyType, value: WorkbookCellValuesSchema.valueType })).min(1) })) })).min(1),
}).superRefine((facts, ctx) => {
  const sheets = new Set(facts.worksheets.map(sheet => sheet.sheetId));
  if (sheets.size !== facts.worksheets.length || new Set(facts.rows.map(row => row.key)).size !== facts.rows.length
    || facts.rows.some(row => (row.state === "missing" ? row.matches.length !== 0 : row.state === "matched" ? row.matches.length !== 1 : row.matches.length < 2)
      || new Set(row.matches.map(match => `${match.sheetId}\0${match.rowId}`)).size !== row.matches.length
      || row.matches.some(match => !sheets.has(match.sheetId) || new Set(match.cells.map(cell => cell.fieldId)).size !== match.cells.length))) {
    ctx.addIssue({ code: "custom", message: "Reference facts require exact key, row, field and worksheet membership" });
  }
});
export const ReadWorkbookReference = defineTaskContract({
  id: taskId("workbooks/read-reference"), title: "Read the selected reference version", effect: "read",
  input: WorkbookReferenceReadSchema,
  output: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("read"), reference: WorkbookReferenceFactsSchema }),
    z.strictObject({ state: z.literal("refused"), code: z.enum(["WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_REVISION_UNAVAILABLE", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED"]) }),
  ]),
  errorCodes: ["WORKBOOK_PROVIDER_UNAVAILABLE", "WORKBOOK_INVALID", "WORKBOOK_NOT_FOUND", "WORKBOOK_REVISION_UNAVAILABLE", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_STORAGE_FAILED"],
  providers: ["workbooks.library"], subject: { kind: "none", reason: "Reads late-discovered people only from the run's captured immutable reference version" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["workbooks/read-reference"], example: { state: "refused", code: "WORKBOOK_REVISION_UNAVAILABLE" },
});
