import { UcpathJobRowSchema } from "../../../src/models/ui/ucpath-job-summary.js";
import type { UcpathJobCell, UcpathJobRow } from "../../../src/models/ui/ucpath-job-summary.js";

function cell(raw: string): UcpathJobCell {
  return raw.length === 0 ? { state: "absent", reason: "the fixture left this cell empty" } : { state: "present", value: raw };
}

/** A job-summary row from fixture cells: Empl Record, Effective Date, HR Status, Business Unit, Position, Dept ID, Department, Job Code, Job Title, Expected Job End Date, FTE, Empl Class. */
export function jobRowFromCells(cells: readonly string[], rowIndex: number): UcpathJobRow {
  const [emplRecord, effectiveDate, hrStatus, businessUnit, positionNumber, deptId, department, jobCode, jobTitle, expectedJobEndDate, fte, emplClass]
    = cells.map((value) => value.trim());
  return UcpathJobRowSchema.parse({
    rowIndex,
    emplRecord,
    hrStatus,
    businessUnit,
    effectiveDate: cell(effectiveDate ?? ""),
    positionNumber: cell(positionNumber ?? ""),
    deptId: cell(deptId ?? ""),
    department: cell(department ?? ""),
    jobCode: cell(jobCode ?? ""),
    jobTitle: cell(jobTitle ?? ""),
    expectedJobEndDate: cell(expectedJobEndDate ?? ""),
    fte: cell(fte ?? ""),
    emplClass: cell(emplClass ?? ""),
  });
}
