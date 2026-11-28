import { z } from "zod";
import { WorkbookIdSchema } from "../../dashboard/workbooks.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";

export const WORKSHEET_ROW_CHOICE_GATE = "worksheet-row-choice";
export const WorksheetRowIdentitySchema = z.strictObject({
  referenceDigest: FingerprintSchema, sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema,
});
export const WorksheetRowChoiceSchema = z.strictObject({
  decision: z.literal("selected"), referenceDigest: FingerprintSchema,
  rows: WorksheetRowIdentitySchema.extend({ key: z.string().min(1) }).array().min(1)
    .refine(rows => new Set(rows.map(row => row.key)).size === rows.length),
});
export type WorksheetRowChoice = z.output<typeof WorksheetRowChoiceSchema>;
