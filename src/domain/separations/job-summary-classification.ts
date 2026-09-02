/**
 * The S21–S24 fold: what a UCPath job-summary grid MEANS, computed from what
 * the grid showed and nothing else.
 *
 * ## Why this is a fold and not part of the read
 *
 * Legacy computes all of this inside the page module, as THROWS
 * (`legacy:src/systems/ucpath/job-summary.ts:278-292`, commit `1bffbd65`):
 * "all rows Terminated" and "2+ non-terminated rows" are error strings, so they
 * exist only in a log, and — the S22 defect — they are computed only when the
 * search happened to render a multi-row grid. A single-employment person who was
 * already terminated auto-redirects to the detail page, the scan never runs, and
 * a second termination gets filed.
 *
 * Both halves of that are fixed by moving the judgment OUT of the read. The read
 * reports every row unconditionally; this fold classifies them unconditionally.
 * A fact that is derived from data the run always holds cannot be skipped by a
 * page layout.
 *
 * ## The tiers are the ported vocabulary, and `unknown` is a real answer
 *
 * `activeTier` uses exactly the predicates the Person Org port already carries
 * (`isInactiveHrStatus` / `employeeStatus` in
 * `src/stores/ucpath/driver/person-org-operation.ts`, ported from legacy
 * `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`). A status this vocabulary does not
 * recognize is `unknown` — never "probably active", never "probably terminated"
 * — and one unknown row makes the whole disposition `indeterminate-status`,
 * because the question "is this person still employed" has no answer when one of
 * their employments does not.
 */
import { z } from "zod";
import type { UcpathJobCell, UcpathJobRow } from "../ui/ucpath-job-summary.js";

export const JobStatusTierSchema = z.enum(["active", "inactive", "unknown"]);
export type JobStatusTier = z.infer<typeof JobStatusTierSchema>;

/**
 * The four things a whole grid can say about whether this person still holds a
 * job. Every arm is a first-class outcome an operator reads at the gate — none
 * of them is an error, and none of them decides anything on its own.
 */
export const JobSummaryDispositionSchema = z.enum([
  /** Exactly one row is active — the ordinary separation shape. */
  "single-active-job",
  /** No row is active. S21/S22: the person may already be fully separated. */
  "no-active-job",
  /** Two or more active rows. S23: which job is being separated is ambiguous. */
  "concurrent-active-jobs",
  /** At least one row's HR status is not in the ported vocabulary. */
  "indeterminate-status",
]);
export type JobSummaryDisposition = z.infer<typeof JobSummaryDispositionSchema>;

export const ClassifiedJobRowSchema = z.strictObject({
  rowIndex: z.number().int().nonnegative(),
  emplRecord: z.string().min(1),
  /** VERBATIM, exactly as UCPath rendered it — the operator reads this word. */
  hrStatus: z.string().min(1),
  tier: JobStatusTierSchema,
  /** `present` department text, or the read's own reason it was blank (S24). */
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
  /**
   * The cells the grid could not show, named. S24 says legacy THROWS on an
   * unreadable department; refusing here would fail an identity check over a
   * cell the identity check does not use, so the absence travels as a listed
   * fact the operator sees instead — surfaced, never skipped.
   */
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

/**
 * Ported verbatim from `person-org-operation.ts`'s `isInactiveHrStatus` /
 * `employeeStatus` (legacy `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`,
 * `src/systems/ucpath/person-org-summary.ts`). The ORDER matters and is the
 * port's: `inactive` is tested before `active`, because "Inactive" contains
 * "active" and a naive `/active/` test would call every separated employee
 * employed.
 */
export function classifyJobStatus(hrStatus: string): JobStatusTier {
  if (/inactive|terminated|separated/iu.test(hrStatus)) return "inactive";
  if (/active/iu.test(hrStatus)) return "active";
  return "unknown";
}

/**
 * An absent cell renders as its OWN reason rather than as a blank or a dash.
 * The identity packet carries this string for the authority deciding the subject;
 * "" and "the grid rendered this cell empty" are different facts and the second
 * one is the true one.
 */
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
