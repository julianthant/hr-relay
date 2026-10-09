/** Which employment row a separation is filed against: exactly one active row or refuse, computed unconditionally from the grid classification, while the operator still sees every row at the gate. */
import { z } from "zod";
import type { UcpathJobRow } from "../../models/ui/ucpath-job-summary.js";
import { UcpathJobCellSchema } from "../../models/ui/ucpath-job-summary.js";
import {
  KualiPayrollTitleCodeSchema,
  KualiPayrollTitleSchema,
} from "../../models/ui/kuali-separation-finalization.js";
import { classifyJobSummary } from "./job-summary-classification.js";

export const EMPLOYMENT_SELECTION_REFUSAL_CODES = [
  /** No active employment remains to end. */
  "no-active-employment",
  /** Multiple active rows cannot identify the job to end. */
  "concurrent-active-employments",
  /** HR status falls outside the accepted vocabulary. */
  "indeterminate-employment-status",
  /** The active Job Code is blank or cannot be staged. */
  "payroll-title-code-unreadable",
  /** The active Job Title is blank or cannot be staged. */
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
