/**
 * The UCPath **job summary** surface — the Person Organizational Summary
 * detail page's *Employment Instances* grid, read WHOLE (D194 / ref task-contract §2.8).
 *
 * ## Why this page and not legacy's `WF_JOB_SUMMARY.GBL`
 *
 * Legacy reads dept/job off *Workforce Job Summary*
 * (`legacy:src/systems/ucpath/job-summary.ts`, commit
 * `1bffbd6537e3f6ff3c66ea1a1a2d1f1e0e7f5b41`'s tree), a page whose facts arrive
 * across two LAZILY rendered tabs (`Work Location`, `Job Information`) with a
 * frozen left column that has to be zipped back on by row count. The Person Org
 * detail page carries the same per-employment facts — empl record, HR status,
 * effective date, business unit, position, dept id + description, job code +
 * description, expected end date, FTE, empl class — as **one** grid on **one**
 * visit, and this tree has already live-verified and registered every anchor it
 * needs (`src/stores/ucpath/driver/ui-registry.ts`, 2026-08-02). One page visit
 * for the whole surface is exactly what D194 asks for, so the read is authored
 * here rather than against a page that would need two.
 *
 * The one fact the two pages do NOT share is legacy's *effective-dated history
 * per empl record* ("what was this job on the separation date"). That belongs to
 * the termination-filing chunk, which is the only consumer that has ever needed
 * it, and it is a second page visit either way.
 *
 * ## S21 / S22 / S23 / S24 become DATA here, never judgment
 *
 * The read reports what the grid showed: every row, its status **verbatim**, and
 * how many rows there were. "All terminated", "has an active job", "two
 * concurrent jobs" and "already separated" are pure folds over that (see
 * `src/domain/separations/job-summary-classification.ts`) — S22's silent risk is that
 * legacy only ever *derived* those facts as a side effect of drilling a
 * multi-row grid, so a single-row already-terminated person was never checked at
 * all. A fact that is read unconditionally cannot be skipped by a page layout.
 *
 * ## Absent arms are for genuinely-optional CELLS only (S24)
 *
 * Empl record, HR status and business unit are structural: every rendered row
 * carries them, and a row missing one is a broken read, not an empty field. The
 * descriptive cells (department, job code, title, position, dates, FTE, class)
 * are the ones the live grid can legitimately render blank, so each is an
 * explicit `{state:"absent", reason}` — surfaced as data, never silently
 * dropped and never guessed. Legacy throws on an unreadable department (S24);
 * that refusal belongs to the consumer that NEEDS the department, not to the
 * read, which would otherwise fail an identity check over a cell the identity
 * check does not use.
 */
import { z } from "zod";
import { EidSchema, IsoInstantSchema } from "../ids.js";

/**
 * One optional grid cell.
 *
 * The `absent` arm carries a reason for the same reason every absent arm in this
 * tree does: a blank that cannot say why it is blank is indistinguishable from a
 * selector that matched nothing (the Kuali `Location` lesson, 2026-08-12).
 */
export const UcpathJobCellSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type UcpathJobCell = z.infer<typeof UcpathJobCellSchema>;

/**
 * One *Employment Instances* row, verbatim.
 *
 * `hrStatus` is deliberately a free string and NOT an enum: UCPath's own wording
 * is the evidence an operator reads at the gate, and normalizing it here would
 * make the gate show a word this repository chose rather than the word UCPath
 * did. The classification fold owns the interpretation.
 */
export const UcpathJobRowSchema = z.strictObject({
  /** 0-based position in the grid as rendered — the row's read identity. */
  rowIndex: z.number().int().nonnegative(),
  /** Empl Record number, verbatim (`"0"`, `"1"`, …). */
  emplRecord: z.string().min(1),
  /** HR Status, VERBATIM — `Active`, `Inactive`, `Terminated`, … */
  hrStatus: z.string().min(1),
  /** Business unit, e.g. `SDCMP`. Structural: every row carries one. */
  businessUnit: z.string().min(1),
  effectiveDate: UcpathJobCellSchema,
  positionNumber: UcpathJobCellSchema,
  deptId: UcpathJobCellSchema,
  department: UcpathJobCellSchema,
  jobCode: UcpathJobCellSchema,
  jobTitle: UcpathJobCellSchema,
  expectedJobEndDate: UcpathJobCellSchema,
  fte: UcpathJobCellSchema,
  emplClass: UcpathJobCellSchema,
});
export type UcpathJobRow = z.infer<typeof UcpathJobRowSchema>;

/**
 * How the page under the read was reached, and how complete its grid is.
 *
 * PeopleSoft auto-redirects a single-result search straight to the detail page
 * and renders a grid otherwise; and an *Employment Instances* grid paginates
 * until its `View All` control has been driven to `View N`. Both facts decide
 * whether `rowCount` means "every employment this person has" — so both are
 * reported rather than assumed.
 */
export const UcpathJobSummaryRenderContextSchema = z.strictObject({
  entry: z.enum(["auto-detail", "drilled-from-grid"]),
  /** Rows the search grid rendered before the drill-in; `0` on `auto-detail`. */
  searchResultRows: z.number().int().nonnegative(),
  employmentInstances: z.enum(["already-complete", "expanded"]),
});
export type UcpathJobSummaryRenderContext = z.infer<typeof UcpathJobSummaryRenderContextSchema>;

export const UCPATH_JOB_SUMMARY_PAGE_STATE = "ucpath.person-org.detail-ready";

/** The whole job-summary surface for ONE proven person, from ONE page visit. */
export const UcpathJobSummarySchema = z.strictObject({
  /** The state the detail page was proved to be in before anything was read. */
  pageStateId: z.literal(UCPATH_JOB_SUMMARY_PAGE_STATE),
  /** The EID the run asked for AND the page displayed — they are proved equal. */
  emplId: EidSchema,
  /** The person identity the PAGE displays, verbatim. */
  displayedName: z.string().min(1),
  jobRows: z.array(UcpathJobRowSchema).min(1),
  /** `jobRows.length`, restated so a consumer can assert it without counting. */
  rowCount: z.number().int().positive(),
  renderContext: UcpathJobSummaryRenderContextSchema,
  observedAt: IsoInstantSchema,
}).superRefine((summary, context) => {
  if (summary.rowCount !== summary.jobRows.length) {
    context.addIssue({
      code: "custom",
      path: ["rowCount"],
      message: `rowCount ${String(summary.rowCount)} disagrees with ${String(summary.jobRows.length)} rendered rows`,
    });
  }
  const indices = summary.jobRows.map(({ rowIndex }) => rowIndex);
  if (new Set(indices).size !== indices.length) {
    context.addIssue({ code: "custom", path: ["jobRows"], message: "job row indices must be unique" });
  }
});
export type UcpathJobSummary = z.infer<typeof UcpathJobSummarySchema>;

/**
 * Every EXPECTED negative is an outcome; everything mechanical throws.
 *
 * `employee-not-found` is a real answer from UCPath (S18/S19 hang off it), and
 * `subject-mismatch` is the drill-in check the Person Org port already performs
 * — surfaced here as its own arm so the task can give it its own durable code
 * instead of collapsing into `unexpected-page-state`.
 */
export const UcpathJobSummaryReadSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("read"), summary: UcpathJobSummarySchema }),
  z.strictObject({
    state: z.literal("employee-not-found"),
    emplId: EidSchema,
    /** The positive no-results marker the page rendered, verbatim. */
    observedMarker: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("subject-mismatch"),
    expectedEid: EidSchema,
    observedEid: EidSchema,
  }),
]);
export type UcpathJobSummaryRead = z.infer<typeof UcpathJobSummaryReadSchema>;
