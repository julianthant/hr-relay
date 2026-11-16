import { z } from "zod";
import { WorkbookIdSchema } from "../../dashboard/workbooks.js";
import { taskId } from "../../../rules/identity/ids.js";
import { ReferenceCheckOutcomeSchema, ReferenceCheckResultSchema, referenceCheckLine, referenceCheckResult } from "../../../rules/matching/reference-check.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { WorkbookRefusalSchema } from "./read-result.js";

/** The optional second check every workflow declares: any library sheet with an Employee ID column fits. */
export const REFERENCE_CHECK = deepFreeze({ id: "reference-check", keyFieldId: "eid" } as const);

const text = z.string().min(1);
export const WorkbookPersonCheckRequestSchema = z.strictObject({ typeId: WorkbookIdSchema, eid: text.nullable(), name: text.nullable() });
/** One picked spreadsheet's answer: its names, the outcome and the row number, never a value from the row. */
const check = z.strictObject({ spreadsheet: text, sheet: text, outcome: ReferenceCheckOutcomeSchema,
  row: z.number().int().positive().nullable(), line: text });
export const WorkbookPersonCheckSchema = z.strictObject({
  state: z.literal("checked"), result: ReferenceCheckResultSchema, checks: check.array(),
}).superRefine((value, ctx) => {
  const expected = value.result === "no-person" ? value.checks.length === 0
    : value.checks.length > 0 && value.result === referenceCheckResult(value.checks.map(item => item.outcome));
  if (!expected || value.checks.some(item => (item.row === null) !== (item.outcome === "not-found")
    || item.line !== referenceCheckLine(item.spreadsheet, item.sheet, item))) {
    ctx.addIssue({ code: "custom", message: "reference check result, rows and lines must agree with each outcome" });
  }
});
export const WorkbookPersonCheckResponseSchema = z.discriminatedUnion("state", [WorkbookPersonCheckSchema, WorkbookRefusalSchema]);

export const VerifyWorkbookPerson = defineTaskContract({
  id: taskId("workbooks/verify-person"), title: "Check person in reference spreadsheets", effect: "read",
  input: WorkbookPersonCheckRequestSchema, output: WorkbookPersonCheckSchema,
  providers: ["workbooks.library"], errorCodes: ["WORKBOOK_PROVIDER_UNAVAILABLE", ...WorkbookRefusalSchema.shape.code.options],
  subject: { kind: "none", reason: "Looks the found Employee ID up in the run's exact retained spreadsheet versions through its bound provider" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["workbooks/verify-person"],
  example: { state: "checked", result: "unconfirmed", checks: [
    { spreadsheet: "Fixture roster", sheet: "People", outcome: "found", row: 2, line: "Fixture roster · People: found in row 2" },
    { spreadsheet: "Fixture badges", sheet: "Issued", outcome: "not-found", row: null, line: "Fixture badges · Issued: not found" },
  ] },
});
