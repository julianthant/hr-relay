/** The UCPath **job summary** surface: the Person Organizational Summary detail page's *Employment Instances* grid, read WHOLE on ONE page visit. */
import { z } from "zod";
import { EidSchema, IsoInstantSchema } from "../../rules/identity/ids.js";

/** One optional grid cell; the `absent` arm carries a reason, because a blank that cannot say why is indistinguishable from a selector that matched nothing. */
export const UcpathJobCellSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type UcpathJobCell = z.infer<typeof UcpathJobCellSchema>;

/** One *Employment Instances* row, verbatim; `hrStatus` is deliberately a free string, because UCPath's own wording is the evidence an operator reads at the gate. */
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

/** The structural cells every rendered row carries; a row missing one is a broken read, not an empty field. */
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

/** Structural gaps refuse reads; consumers validate descriptive cells only when needed. */
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
