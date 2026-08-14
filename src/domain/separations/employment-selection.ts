/**
 * **S23/S24, decided** — which employment row a separation is filed against.
 *
 * ## Why this refuses where chunk 3 reports
 *
 * `separations-identity-check` deliberately does NOT decide "already
 * terminated": it reports the whole grid and its classification, *"whether a
 * person with no active job should be separated anyway is a question for the
 * human at the gate."* That is right for a workflow whose product is an approved
 * subject and that files nothing.
 *
 * The composition files. A UCPath termination needs ONE `Empl Record` number,
 * and a Kuali finalization needs ONE payroll title code and title — so a grid
 * this fold cannot reduce to one row is a run that cannot compute what it is
 * about to write. It therefore refuses BEFORE the gate opens, which is chunk 4's
 * argument for `termination-type` and chunk 5's for `department-option` applied
 * a third time: a refusal the operator cannot act on should not cost them a
 * decision first. The classification the operator DOES see at the gate still
 * carries every row, so nothing is hidden — the fold only decides whether there
 * is a single row to file against.
 *
 * ## Exactly one active row, or refuse. That is legacy's rule too.
 *
 * Legacy throws on "all rows Terminated" and on "2+ non-terminated rows"
 * (`legacy:src/systems/ucpath/job-summary.ts:278-292` @ `1bffbd65…`, and D201
 * records that it only computes them when the search happened to render a
 * multi-row grid). This fold computes them unconditionally from
 * `classifyJobSummary`, which is D201's whole point. Legacy's other half —
 * "pick the effective-dated row at or before the separation date" — is NOT
 * ported: it is a tiebreak for a case legacy also throws on, and inventing a
 * date-based picker for concurrent employments would be deciding which of a
 * person's two jobs to end. A real concurrent case is a §3.1 recomposition.
 *
 * ## The consumer that NEEDS a cell is the one that refuses (D201)
 *
 * The payroll title code and title are staged into a live Kuali document, so an
 * unreadable one refuses HERE, by name. The Dept ID and Department cells travel
 * onward AS CELLS — `match-department-option` already owns their refusal
 * (`department-code-unreadable`), and duplicating it would give one fact two
 * durable codes.
 */
import { z } from "zod";
import type { UcpathJobRow } from "../ui/ucpath-job-summary.js";
import { UcpathJobCellSchema } from "../ui/ucpath-job-summary.js";
import {
  KualiPayrollTitleCodeSchema,
  KualiPayrollTitleSchema,
} from "../ui/kuali-separation-finalization.js";
import { classifyJobSummary } from "./job-summary-classification.js";

export const EMPLOYMENT_SELECTION_REFUSAL_CODES = [
  /** No row is active — S21/S22. There is no employment to end. */
  "no-active-employment",
  /** Two or more active rows — S23. Which job is being separated is not derivable. */
  "concurrent-active-employments",
  /** At least one row's HR status is outside the ported vocabulary. */
  "indeterminate-employment-status",
  /** The active row's Job Code is blank or cannot be staged into Kuali (S24). */
  "payroll-title-code-unreadable",
  /** The active row's Job Title is blank or cannot be staged into Kuali (S24). */
  "payroll-title-unreadable",
] as const;
export const EmploymentSelectionRefusalCodeSchema = z.enum(EMPLOYMENT_SELECTION_REFUSAL_CODES);
export type EmploymentSelectionRefusalCode = z.infer<typeof EmploymentSelectionRefusalCodeSchema>;

export const SelectedEmploymentSchema = z.strictObject({
  /** The row's position in the grid as rendered — its read identity. */
  rowIndex: z.number().int().nonnegative(),
  /** The `Empl Record` the UCPath termination is filed against. */
  emplRecord: z.string().min(1),
  /** HR Status, VERBATIM — the word UCPath used, which is what the operator reads. */
  hrStatus: z.string().min(1),
  businessUnit: z.string().min(1),
  /** The Dept ID cell, PASSED THROUGH — `match-department-option` owns its refusal. */
  deptId: UcpathJobCellSchema,
  department: UcpathJobCellSchema,
  /** Staged into the Kuali document, so an unreadable one refuses here. */
  payrollTitleCode: KualiPayrollTitleCodeSchema,
  payrollTitle: KualiPayrollTitleSchema,
  /** The row's own effective date cell, carried for the operator. */
  effectiveDate: UcpathJobCellSchema,
  /** How many employment rows the grid held — the context for "exactly one". */
  rowCount: z.number().int().positive(),
});
export type SelectedEmployment = z.infer<typeof SelectedEmploymentSchema>;

export const EmploymentSelectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("selected"), employment: SelectedEmploymentSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: EmploymentSelectionRefusalCodeSchema,
    reason: z.string().min(1),
  }),
]);
export type EmploymentSelection = z.infer<typeof EmploymentSelectionSchema>;

function describeRows(rows: readonly UcpathJobRow[]): string {
  return rows
    .map((row) => `#${String(row.rowIndex)} empl record ${row.emplRecord} — ${row.hrStatus}`)
    .join("; ");
}

export function selectSeparationEmployment(
  rows: readonly UcpathJobRow[],
): EmploymentSelection {
  const classification = classifyJobSummary(rows);
  if (classification.disposition === "indeterminate-status") {
    return EmploymentSelectionSchema.parse({
      state: "refused",
      code: "indeterminate-employment-status",
      reason: `UCPath rendered ${String(classification.unknownRowCount)} of `
        + `${String(classification.rowCount)} employment rows with an HR status this system does not `
        + `recognize (${describeRows(rows)}). "Is this person still employed" has no answer while one of `
        + "their employments does not, and a termination is filed against ONE of them.",
    });
  }
  if (classification.disposition === "no-active-job") {
    return EmploymentSelectionSchema.parse({
      state: "refused",
      code: "no-active-employment",
      reason: `UCPath shows no active employment for this person (${describeRows(rows)}). They may `
        + "already be fully separated (S21/S22) — legacy computes this only when the search happened to "
        + "render a multi-row grid, which is why a single-employment person who was already terminated "
        + "was never checked at all. There is no employment for this separation to end.",
    });
  }
  if (classification.disposition === "concurrent-active-jobs") {
    return EmploymentSelectionSchema.parse({
      state: "refused",
      code: "concurrent-active-employments",
      reason: `UCPath shows ${String(classification.activeRowCount)} concurrent active employments `
        + `(${describeRows(rows)}). Which job is being separated is not derivable from the separation `
        + "document, and picking one would end an appointment nobody named (S23). A case that genuinely "
        + "needs this is a §3.1 recomposition, not a tiebreak invented here.",
    });
  }

  const active = rows.find((row) => classification.rows
    .some((classified) => classified.rowIndex === row.rowIndex && classified.tier === "active"));
  if (active === undefined) {
    throw new Error(
      "the job-summary classification reported exactly one active row and no grid row carries its "
      + "index; the two are derived from one list, so this is a fabricated classification",
    );
  }

  const payrollTitleCode = KualiPayrollTitleCodeSchema.safeParse(
    active.jobCode.state === "present" ? active.jobCode.value : undefined,
  );
  if (!payrollTitleCode.success) {
    return EmploymentSelectionSchema.parse({
      state: "refused",
      code: "payroll-title-code-unreadable",
      reason: `the active employment (empl record ${active.emplRecord}) carries no usable Job Code `
        + `(${active.jobCode.state === "absent" ? active.jobCode.reason : JSON.stringify(active.jobCode.value)}). `
        + "It is staged into the Kuali document as the Payroll Title Code, and legacy fails loud on a "
        + "blank one too (S24).",
    });
  }
  const payrollTitle = KualiPayrollTitleSchema.safeParse(
    active.jobTitle.state === "present" ? active.jobTitle.value : undefined,
  );
  if (!payrollTitle.success) {
    return EmploymentSelectionSchema.parse({
      state: "refused",
      code: "payroll-title-unreadable",
      reason: `the active employment (empl record ${active.emplRecord}) carries no usable Job Title `
        + `(${active.jobTitle.state === "absent" ? active.jobTitle.reason : JSON.stringify(active.jobTitle.value)}). `
        + "It is staged into the Kuali document as the Payroll Title.",
    });
  }

  return EmploymentSelectionSchema.parse({
    state: "selected",
    employment: {
      rowIndex: active.rowIndex,
      emplRecord: active.emplRecord,
      hrStatus: active.hrStatus,
      businessUnit: active.businessUnit,
      deptId: active.deptId,
      department: active.department,
      payrollTitleCode: payrollTitleCode.data,
      payrollTitle: payrollTitle.data,
      effectiveDate: active.effectiveDate,
      rowCount: classification.rowCount,
    },
  });
}
