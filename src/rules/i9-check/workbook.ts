import type { I9CheckRow } from "../../models/workflows/i9-check/check.js";
import { I9CheckRowsSchema } from "../../models/workflows/i9-check/check.js";
import { WorkbookTableSchema } from "../../models/processing/workbooks/read-result.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";

export function i9CheckWorkbookTable(rows: readonly I9CheckRow[]) {
  return WorkbookTableSchema.parse({ name: "I-9 Check", rowSubject: "person", columns: [
    "Employee Name", "PPS EID", "UCPATH Employee ID", "Hire Date (from I-9)", "Separation Date",
    "Found in UCPath?", "Action", "Reviewer Name", "Notes",
  ], rows: rows.map(row => ({ id: row.recordId, values: [row.employeeName, row.ppsEid, row.ucpathEmplId,
    row.hireDate, row.separationDate, row.foundInUcpath, row.action, row.reviewerName, row.notes] })) });
}

export function i9CheckTrackerTable(records: readonly Readonly<{ payload: unknown; projectedAt: string }>[]) {
  const people = new Map<string, { row: I9CheckRow; projectedAt: string }>();
  for (const record of records) for (const row of I9CheckRowsSchema.parse(record.payload).rows) {
    const previous = people.get(row.recordId);
    if (previous?.projectedAt === record.projectedAt && canonicalJsonStringify(previous.row) !== canonicalJsonStringify(row)) {
      throw new Error("i9-check-tracker-conflicting-observations");
    }
    if (previous === undefined || previous.projectedAt < record.projectedAt) people.set(row.recordId, { row, projectedAt: record.projectedAt });
  }
  return i9CheckWorkbookTable([...people.values()].map(value => value.row));
}
