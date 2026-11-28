import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { WorkbookIdSchema } from "../../dashboard/workbooks.js";
import { WorkbookRefusalSchema } from "./read-result.js";

export const REFERENCE_CHECK_ID = "reference-check";
export const REFERENCE_LOOKUP_NODE = "reference-person-lookup";
export const ReferenceKeyFieldSchema = z.enum(["eid", "email"]);
export const EMPLOYEE_REFERENCE_CHECK = Object.freeze({ id: REFERENCE_CHECK_ID, keyFieldId: "eid" });
export const ReferenceReviewSchema = z.strictObject({ decision: z.literal("continue") });
const REVIEW_PREFIX = "reference-field-review";
export function referenceReviewId(suffix: string): string { return `${REVIEW_PREFIX}-${suffix}`; }
export function referenceComparisonForGate(gateId: string): string | undefined {
  return gateId.startsWith(`${REVIEW_PREFIX}-`) ? `reference-fields-${gateId.slice(REVIEW_PREFIX.length + 1)}` : undefined;
}
const text = z.string().min(1);
const FieldSchema = z.strictObject({ field: text, value: text });
const ReferenceRowSchema = z.strictObject({ row: z.number().int().positive(), values: z.array(FieldSchema.extend({ value: z.string() })) });
const ReferenceSheetIdentity = { source: text, sheet: text };
const ReferenceSheetSchema = z.strictObject({ ...ReferenceSheetIdentity, rows: z.array(ReferenceRowSchema) });
const ReferenceSheetsSchema = z.array(ReferenceSheetSchema);
const ComparisonSchema = z.strictObject({ ...ReferenceSheetIdentity, row: ReferenceRowSchema.shape.row, field: text });
const ApprovedFieldSchema = ComparisonSchema.pick({ source: true, field: true });
const MatchSchema = ComparisonSchema.omit({ source: true });
const MismatchSchema = ComparisonSchema.extend({ expected: z.string(), actual: text });

export type ReferenceSheet = z.output<typeof ReferenceSheetSchema>;
export type ReferenceField = z.output<typeof FieldSchema>;
export type ReferenceFieldApproval = z.output<typeof ApprovedFieldSchema>;
export type ReferenceMatch = z.output<typeof MatchSchema>;
export type ReferenceMismatch = z.output<typeof MismatchSchema>;

export const ReadReferenceFieldsRequestSchema = z.strictObject({
  typeId: WorkbookIdSchema, key: text, columns: z.array(text).min(1),
});
export const ReadReferenceFieldsResultSchema = z.strictObject({ state: z.literal("read-fields"), sheets: ReferenceSheetsSchema });
export const ReadReferenceFieldsResponseSchema = z.discriminatedUnion("state", [ReadReferenceFieldsResultSchema, WorkbookRefusalSchema]);

export const CompareReferenceFields = defineTaskContract({
  id: taskId("workbooks/read-reference-fields"), title: "Compare reference fields", effect: "read",
  input: z.strictObject({
    keyField: ReferenceKeyFieldSchema, read: ReadReferenceFieldsRequestSchema.nullable(), sheets: ReferenceSheetsSchema.nullable(),
    fields: z.array(FieldSchema), approved: z.array(ApprovedFieldSchema), last: z.boolean(),
  }),
  output: z.strictObject({
    captured: ReferenceSheetsSchema.nullable(), matches: z.array(MatchSchema), mismatches: z.array(MismatchSchema),
    review: z.literal(true).nullable(),
  }),
  providers: ["workbooks.library"],
  errorCodes: ["WORKBOOK_PROVIDER_UNAVAILABLE", ...WorkbookRefusalSchema.shape.code.options],
  subject: { kind: "none", reason: "Compares resolved fields against this run's selected immutable workbook versions" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["workbooks/verify-person"],
  example: {
    captured: [{ source: "fixture-source", sheet: "Roster", rows: [{ row: 2, values: [{ field: "fullName", value: "Jordan Lee" }] }] }],
    matches: [], mismatches: [{ source: "fixture-source", sheet: "Roster", row: 2, field: "fullName", expected: "Jordan Lee", actual: "Jordan Smith" }],
    review: true,
  },
});
