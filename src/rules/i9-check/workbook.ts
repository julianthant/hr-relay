import type { I9CheckRow } from "../../models/workflows/i9-check/check.js";
import { WorkbookTableSchema } from "../../models/processing/workbooks/read-result.js";

export function i9CheckWorkbookTable(rows: readonly I9CheckRow[]) {
  return WorkbookTableSchema.parse({ name: "I-9 Check", columns: [
    "Employee Name", "PPS EID", "UCPATH Employee ID", "Hire Date (from I-9)", "Separation Date",
    "Found in UCPath?", "Action", "Reviewer Name", "Notes",
  ], rows: rows.map(row => ({ id: row.recordId, values: [row.employeeName, row.ppsEid, row.ucpathEmplId,
    row.hireDate, row.separationDate, row.foundInUcpath, row.action, row.reviewerName, row.notes] })) });
}
