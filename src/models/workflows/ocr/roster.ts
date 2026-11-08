import { z } from "zod";
import { parseRunWorkbookReference, WorkbookIdSchema, WorkbookRevisionSchema } from "../../dashboard/workbooks.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { FingerprintSchema, IsoInstantSchema, WorkflowIdSchema, IntakeTargetFieldIdSchema } from "../../../rules/identity/ids.js";
import { RosterRowFactsSchema } from "../../../rules/matching/roster-match.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { type SchemaBoundCanonicalValue } from "../../validation/schema-bound-value.js";

export const OCR_ROSTER_TYPE_ID = "ocr-roster";
export const OCR_ROSTER_FIELDS = ["eid", "fullName"] as const;

function rosterRows(reference: ReturnType<typeof parseRunWorkbookReference>, readAt: string) {
  const { request, snapshot } = reference;
  if (request.typeId !== OCR_ROSTER_TYPE_ID || snapshot.type.keyFieldId !== "eid"
    || request.fields.length !== OCR_ROSTER_FIELDS.length
    || OCR_ROSTER_FIELDS.some(field => !request.fields.includes(field) || !snapshot.type.fields.includes(field))) {
    throw new Error("ocr-roster-reference-invalid");
  }
  const seen = new Set<string>();
  return snapshot.rows.map((row, index) => {
    const match = row.matches[0];
    if (row.state !== "matched" || match === undefined || row.matches.length !== 1) throw new Error("ocr-roster-membership-invalid");
    const identity = canonicalJsonStringify([match.sheetId, match.rowId]);
    if (seen.has(identity)) throw new Error("ocr-roster-membership-invalid");
    seen.add(identity);
    const eid = match.values.eid, name = match.values.fullName;
    if (eid !== null && typeof eid !== "string" && !(typeof eid === "number" && Number.isSafeInteger(eid) && eid >= 0)) {
      throw new Error("ocr-roster-identity-invalid");
    }
    return OcrRosterRowSchema.parse({ sourceRow: index + 1, sheetId: match.sheetId, rowId: match.rowId,
      eid: eid === null || typeof eid === "string" && eid.trim() === "" ? null : CANONICAL_FIELDS.eid.coerce(String(eid), {
        workflow: WorkflowIdSchema.parse("ocr"), readAt, sourceRow: index + 1, header: "eid", targetFieldId: IntakeTargetFieldIdSchema.parse("employee.employeeId"),
      }),
      name: name === null || typeof name === "string" && name.trim() === "" ? null : CANONICAL_FIELDS.fullName.schema.parse(name) });
  });
}

const OcrRosterRowSchema = RosterRowFactsSchema.extend({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema });
export const OcrWorkbookRosterEvidenceSchema = z.strictObject({
  workbookType: z.literal(OCR_ROSTER_TYPE_ID), workbookId: WorkbookIdSchema, workbookVersion: WorkbookRevisionSchema,
  referenceDigest: FingerprintSchema, readAt: IsoInstantSchema, rows: z.array(OcrRosterRowSchema),
}).superRefine((roster, context) => {
  if (roster.rows.some((row, index) => row.sourceRow !== index + 1)
    || new Set(roster.rows.map(row => canonicalJsonStringify([row.sheetId, row.rowId]))).size !== roster.rows.length) {
    context.addIssue({ code: "custom", message: "OCR roster rows require exact ordered workbook row identities" });
  }
});

export function bindOcrRoster(bound: SchemaBoundCanonicalValue, readAt: string) {
  const reference = parseRunWorkbookReference(bound);
  if (!("mode" in reference.request)) throw new Error("ocr-roster-reference-invalid");
  return OcrWorkbookRosterEvidenceSchema.parse({ workbookType: reference.snapshot.type.id, workbookId: reference.snapshot.libraryId,
    workbookVersion: reference.snapshot.version, referenceDigest: sha256Hex(canonicalJsonStringify(bound)),
    readAt, rows: rosterRows(reference, readAt) });
}
