import { z } from "zod";
import { RunWorkbookNamedReferenceSchema, WorkbookIdSchema, WorkbookCellValuesSchema } from "../../dashboard/workbooks.js";
import { FingerprintSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { WorkbookRefusalSchema } from "./read-result.js";

export const WorkbookReferenceReadRequestSchema = z.strictObject({
  typeId: WorkbookIdSchema, keys: z.string().min(1).array().min(1)
    .refine(keys => new Set(keys).size === keys.length, "reference keys must be unique"),
});
const snapshot = RunWorkbookNamedReferenceSchema.shape.snapshot;
const row = snapshot.shape.rows.element, match = row.shape.matches.element;
const referenceShape = z.strictObject({ ...RunWorkbookNamedReferenceSchema.shape, snapshot: z.strictObject({ ...snapshot.shape,
  versionId: WorkbookIdSchema, versionName: z.string().min(1),
  rows: z.strictObject({ ...row.shape, matches: z.strictObject({ ...match.shape,
    values: z.strictObject({ fieldId: WorkbookCellValuesSchema.keyType, value: WorkbookCellValuesSchema.valueType }).array()
      .refine(cells => new Set(cells.map(cell => cell.fieldId)).size === cells.length, "reference fields must be unique"),
  }).array() }).array(),
}) });
const retainedReference = referenceShape.superRefine((reference, ctx) => {
  if (!RunWorkbookNamedReferenceSchema.safeParse(referenceRecord(reference)).success) ctx.addIssue({ code: "custom", message: "reference must retain exact keys, fields and row membership" });
});
function referenceRecord(reference: z.input<typeof referenceShape>) {
  return { ...reference, snapshot: { ...reference.snapshot, rows: reference.snapshot.rows.map(row => ({ ...row,
    matches: row.matches.map(match => ({ ...match, values: Object.fromEntries(match.values.map(cell => [cell.fieldId, cell.value])) })),
  })) } };
}
const readSource = z.strictObject({ referenceDigest: FingerprintSchema, reference: referenceShape });
export const WorkbookReferenceReadSchema = z.strictObject({
  state: z.literal("read"), referenceDigest: FingerprintSchema, reference: retainedReference, sources: readSource.array(),
});
export const WorkbookReferenceReadResponseSchema = z.discriminatedUnion("state", [WorkbookReferenceReadSchema, WorkbookRefusalSchema]);

export function encodeWorkbookReference(referenceValue: z.input<typeof RunWorkbookNamedReferenceSchema>) {
  const reference = RunWorkbookNamedReferenceSchema.parse(referenceValue);
  return retainedReference.parse({ ...reference, snapshot: { ...reference.snapshot, rows: reference.snapshot.rows.map(row => ({ ...row,
    matches: row.matches.map(match => ({ ...match, values: Object.entries(match.values).map(([fieldId, value]) => ({ fieldId, value })) })),
  })) } });
}
export function decodeWorkbookReference(referenceValue: z.input<typeof retainedReference>) {
  return RunWorkbookNamedReferenceSchema.parse(referenceRecord(retainedReference.parse(referenceValue)));
}

export const ReadWorkbookReference = defineTaskContract({
  id: taskId("workbooks/read-reference"), title: "Read retained workbook reference", effect: "read",
  input: WorkbookReferenceReadRequestSchema, output: WorkbookReferenceReadSchema,
  providers: ["workbooks.library"], errorCodes: ["WORKBOOK_PROVIDER_UNAVAILABLE", ...WorkbookRefusalSchema.shape.code.options],
  subject: { kind: "none", reason: "Reads lookup keys from the source run's exact retained workbook version through its bound provider" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["workbooks/read-reference"],
  example: { state: "read", referenceDigest: "a".repeat(64), reference: {
    request: { typeId: "onboarding-roster", libraryId: "fixture-library", versionId: "fixture-version", keys: ["fixture@example.test"], fields: ["email"] },
    snapshot: { libraryId: "fixture-library", version: 1, versionId: "fixture-version", versionName: "Selected version",
      worksheets: [{ sheetId: "fixture-sheet", name: "July 6" }],
      type: { id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: ["email"], defaultWorkbookId: "fixture-library" },
      rows: [{ key: "fixture@example.test", state: "matched", matches: [{ sheetId: "fixture-sheet", rowId: "fixture-row", values: [{ fieldId: "email", value: "fixture@example.test" }] }] }],
    },
  }, sources: [{ referenceDigest: "a".repeat(64), reference: {
    request: { typeId: "onboarding-roster", libraryId: "fixture-library", versionId: "fixture-version", keys: ["fixture@example.test"], fields: ["email"] },
    snapshot: { libraryId: "fixture-library", version: 1, versionId: "fixture-version", versionName: "Selected version",
      worksheets: [{ sheetId: "fixture-sheet", name: "July 6" }],
      type: { id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: ["email"], defaultWorkbookId: "fixture-library" },
      rows: [{ key: "fixture@example.test", state: "matched", matches: [{ sheetId: "fixture-sheet", rowId: "fixture-row", values: [{ fieldId: "email", value: "fixture@example.test" }] }] }],
    },
  } }] },
});
