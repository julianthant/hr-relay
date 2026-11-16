/** What a UCPath job-summary grid MEANS, computed from what the grid showed and nothing else: the read reports every row unconditionally and this fold classifies them unconditionally. */
import { z } from "zod";
import type { UcpathJobCell, UcpathJobRow } from "../../models/ui/ucpath-job-summary.js";

export const JobStatusTierSchema = z.enum(["active", "inactive", "unknown"]);
export type JobStatusTier = z.infer<typeof JobStatusTierSchema>;

/** The four things a whole grid can say about whether this person still holds a job; every arm is a first-class outcome, and none of them is an error. */
export const JobSummaryDispositionSchema = z.enum([
  /** Exactly one row is active — the ordinary separation shape. */
  "single-active-job",
  /** No active row may mean the person is fully separated. */
  "no-active-job",
  /** Multiple active rows leave the job ambiguous. */
  "concurrent-active-jobs",
  /** HR status falls outside the accepted vocabulary. */
  "indeterminate-status",
]);
export type JobSummaryDisposition = z.infer<typeof JobSummaryDispositionSchema>;

export const ClassifiedJobRowSchema = z.strictObject({
  rowIndex: z.number().int().nonnegative(),
  emplRecord: z.string().min(1),
  /** VERBATIM, exactly as UCPath rendered it — the operator reads this word. */
  hrStatus: z.string().min(1),
  tier: JobStatusTierSchema,
  /** Preserve department text or the read's own absence reason. */
  department: z.string().min(1),
  jobTitle: z.string().min(1),
  effectiveDate: z.string().min(1),
});
export type ClassifiedJobRow = z.infer<typeof ClassifiedJobRowSchema>;

export const JobSummaryClassificationSchema = z.strictObject({
  disposition: JobSummaryDispositionSchema,
  rowCount: z.number().int().positive(),
  activeRowCount: z.number().int().nonnegative(),
  inactiveRowCount: z.number().int().nonnegative(),
  unknownRowCount: z.number().int().nonnegative(),
  rows: z.array(ClassifiedJobRowSchema).min(1),
    /* The cells the grid could not show, named: the absence travels as a listed fact the operator sees instead of failing a check over a cell it does not use. */
  unreadableCells: z.array(z.string().min(1)),
}).superRefine((classification, context) => {
  const total = classification.activeRowCount
    + classification.inactiveRowCount
    + classification.unknownRowCount;
  if (total !== classification.rowCount) {
    context.addIssue({
      code: "custom",
      path: ["rowCount"],
      message: `tier counts total ${String(total)} but the grid held ${String(classification.rowCount)} rows`,
    });
  }
  if (classification.rows.length !== classification.rowCount) {
    context.addIssue({ code: "custom", path: ["rows"], message: "every grid row must be classified" });
  }
});
export type JobSummaryClassification = z.infer<typeof JobSummaryClassificationSchema>;

/** Check inactive first because it contains active. */
function classifyJobStatus(hrStatus: string): JobStatusTier {
  if (/inactive|terminated|separated/iu.test(hrStatus)) return "inactive";
  if (/active/iu.test(hrStatus)) return "active";
  return "unknown";
}

/** An absent cell renders as its OWN reason rather than as a blank or a dash: `""` and "the grid rendered this cell empty" are different facts. */
function cellText(cell: UcpathJobCell): string {
  return cell.state === "present" ? cell.value : `(unreadable: ${cell.reason})`;
}

export function classifyJobSummary(
  rows: readonly UcpathJobRow[],
): JobSummaryClassification {
  if (rows.length === 0) {
    throw new Error(
      "job-summary classification received an empty grid; the read refuses to return one, so an "
      + "empty grid here means a caller fabricated it",
    );
  }
  const classified = rows.map((row) => ({
    rowIndex: row.rowIndex,
    emplRecord: row.emplRecord,
    hrStatus: row.hrStatus,
    tier: classifyJobStatus(row.hrStatus),
    department: cellText(row.department),
    jobTitle: cellText(row.jobTitle),
    effectiveDate: cellText(row.effectiveDate),
  }));
  const activeRowCount = classified.filter(({ tier }) => tier === "active").length;
  const inactiveRowCount = classified.filter(({ tier }) => tier === "inactive").length;
  const unknownRowCount = classified.filter(({ tier }) => tier === "unknown").length;
  const disposition: JobSummaryDisposition = unknownRowCount > 0
    ? "indeterminate-status"
    : activeRowCount === 0
      ? "no-active-job"
      : activeRowCount === 1
        ? "single-active-job"
        : "concurrent-active-jobs";
  const unreadableCells: string[] = [];
  for (const row of rows) {
    for (const [name, cell] of [
      ["Effective Date", row.effectiveDate],
      ["Position Number", row.positionNumber],
      ["Dept ID", row.deptId],
      ["Department", row.department],
      ["Job Code", row.jobCode],
      ["Job Title", row.jobTitle],
      ["Expected Job End Date", row.expectedJobEndDate],
      ["FTE", row.fte],
      ["Empl Class", row.emplClass],
    ] as const) {
      if (cell.state === "absent") {
        unreadableCells.push(`row ${String(row.rowIndex)} (empl record ${row.emplRecord}): ${name}`);
      }
    }
  }
  return JobSummaryClassificationSchema.parse({
    disposition,
    rowCount: rows.length,
    activeRowCount,
    inactiveRowCount,
    unknownRowCount,
    rows: classified,
    unreadableCells,
  });
}
