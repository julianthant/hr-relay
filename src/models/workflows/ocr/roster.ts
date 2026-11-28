import { z } from "zod";
import { WorkbookIdSchema, WorkbookRevisionSchema } from "../../dashboard/workbooks.js";
import { FingerprintSchema, IsoInstantSchema } from "../../../rules/identity/ids.js";
import { RosterRowFactsSchema } from "../../../rules/matching/roster-match.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export const OCR_ROSTER_TYPE_ID = "ocr-roster";
export const OCR_ROSTER_FIELDS = ["eid", "fullName"] as const;

const OcrRosterRowSchema = RosterRowFactsSchema.extend({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema, referenceDigest: FingerprintSchema.optional() });
export const OcrWorkbookRosterEvidenceSchema = z.strictObject({
  workbookType: z.literal(OCR_ROSTER_TYPE_ID), workbookId: WorkbookIdSchema, workbookVersion: WorkbookRevisionSchema,
  referenceDigest: FingerprintSchema, readAt: IsoInstantSchema, rows: z.array(OcrRosterRowSchema),
}).superRefine((roster, context) => {
  if (roster.rows.some((row, index) => row.sourceRow !== index + 1)
    || new Set(roster.rows.map(row => canonicalJsonStringify([row.referenceDigest ?? roster.referenceDigest, row.sheetId, row.rowId]))).size !== roster.rows.length) {
    context.addIssue({ code: "custom", message: "OCR roster rows require exact ordered workbook row identities" });
  }
});

export type OcrWorkbookRosterEvidence = z.output<typeof OcrWorkbookRosterEvidenceSchema>;
