/** Which employment row a separation is filed against: the job the form's Student Title Code names, else exactly one active row or the only record when UCPath shows no status for it, else refuse; computed from the classification while the operator still sees every row at the gate. */
import { z } from "zod";
import type { UcpathJobRow } from "../../models/ui/ucpath-job-summary.js";
import { UcpathJobCellSchema } from "../../models/ui/ucpath-job-summary.js";
import {
  KualiPayrollTitleCodeSchema,
  KualiPayrollTitleSchema,
} from "../../models/ui/kuali-separation-finalization.js";
import {
  KUALI_BLANK_OPTION_TEXT,
  KualiOptionFieldSchema,
  KualiTextFieldSchema,
} from "../../models/ui/kuali-separation-document.js";
import type { JobSummaryClassification } from "./job-summary-classification.js";
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
  /** The Student Title Code is filled with something that is not a title code. */
  "requested-title-unreadable",
  /** The comments and the Student Title Code name different jobs. */
  "requested-title-conflict",
  /** The job the form names is no longer active. */
  "requested-employment-inactive",
  /** More than one active job carries the title the form names. */
  "requested-title-ambiguous",
  /** No row carries the title the form names, and no single student job stands in for it. */
  "requested-title-not-found",
] as const;
export const EmploymentSelectionRefusalCodeSchema = z.enum(EMPLOYMENT_SELECTION_REFUSAL_CODES);
export type EmploymentSelectionRefusalCode = z.infer<typeof EmploymentSelectionRefusalCodeSchema>;

export const SelectedEmploymentSchema = z.strictObject({
  /** The row's position in the grid as rendered — its read identity. */
  rowIndex: z.number().int().nonnegative(),
  /** The `Empl Record` the UCPath termination is filed against. */
  emplRecord: z.string().min(1),
  /** HR Status, VERBATIM — the word UCPath used, which is what the operator reads — or why no status shows. */
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

/** What the Kuali form says about WHICH job ends: its Student Title Code and the comments that may name a STDT level. */
export const EmploymentRequestSchema = z.strictObject({
  studentTitleCode: KualiOptionFieldSchema,
  additionalComments: KualiTextFieldSchema,
});
export type EmploymentRequest = z.infer<typeof EmploymentRequestSchema>;

const STDT_LEVEL_CODES: Readonly<Record<string, string>> = { "2": "004921", "3": "004920", "4": "004919" };
const STDT_JOB_CODES = new Set(Object.values(STDT_LEVEL_CODES));

type Refusal = Extract<EmploymentSelection, { state: "refused" }>;

function refuse(code: EmploymentSelectionRefusalCode, reason: string): Refusal {
  return { state: "refused", code, reason };
}

/** `4920` and `004920` are the same title code; anything else is not one. */
function normalizeJobCode(code: string): string | undefined {
  const digits = /^(\d{4,6})$/u.exec(code.trim())?.[1];
  return digits === undefined ? undefined : digits.padStart(6, "0");
}

function requestedJobCode(request: EmploymentRequest): { code: string | undefined } | Refusal {
  let selected: string | undefined;
  const title = request.studentTitleCode;
  if (title.state === "present" && title.value.trim() !== KUALI_BLANK_OPTION_TEXT) {
    const digits = /^(\d{4,6})\s*-/u.exec(title.value.trim())?.[1];
    if (digits === undefined) {
      return refuse("requested-title-unreadable", `the form's Student Title Code ${JSON.stringify(title.value)} `
        + "does not start with a title code, so it cannot say which job ends.");
    }
    selected = digits.padStart(6, "0");
  }
  const comments = request.additionalComments.state === "present" ? request.additionalComments.value : "";
  const named = new Set(Array.from(comments.matchAll(/\bSTDT\s*([234])\b/giu), (match) => STDT_LEVEL_CODES[match[1] ?? ""]));
  if (named.size > 1) {
    return refuse("requested-title-conflict", `the form's comments name more than one student title (${comments}); `
      + "correct the form before a job is separated.");
  }
  const fromComment = [...named][0];
  if (fromComment !== undefined && selected !== undefined && fromComment !== selected) {
    return refuse("requested-title-conflict", `the form's comments name job ${fromComment}, but its Student Title `
      + `Code names ${selected}; correct the form before a job is separated.`);
  }
  return { code: fromComment ?? selected };
}

function jobKey(row: UcpathJobRow): string {
  if (row.positionNumber.state === "present") return `${row.emplRecord}|${row.positionNumber.value}`;
  return `${row.emplRecord}|${row.jobCode.state === "present" ? normalizeJobCode(row.jobCode.value) ?? "" : ""}`;
}

function isStudentJob(row: UcpathJobRow): boolean {
  const code = row.jobCode.state === "present" ? normalizeJobCode(row.jobCode.value) : undefined;
  return (code !== undefined && STDT_JOB_CODES.has(code))
    || (row.jobTitle.state === "present" && /\bSTDT\b/iu.test(row.jobTitle.value));
}

function describeRows(rows: readonly UcpathJobRow[]): string {
  return rows
    .map((row) => `#${String(row.rowIndex)} empl record ${row.emplRecord} — ${row.hrStatus.state === "present" ? row.hrStatus.value : "status not shown"}`)
    .join("; ");
}

export function selectSeparationEmployment(
  rows: readonly UcpathJobRow[],
  request: EmploymentRequest,
): EmploymentSelection {
  const classification = classifyJobSummary(rows);
  const requested = requestedJobCode(request);
  if ("state" in requested) return EmploymentSelectionSchema.parse(requested);
  const chosen = requested.code === undefined
    ? selectWithoutTitle(rows, classification)
    : selectByTitle(rows, classification, requested.code);
  if ("state" in chosen) return EmploymentSelectionSchema.parse(chosen);
  return stageEmployment(chosen.row, classification.rowCount);
}

function tierOf(classification: JobSummaryClassification, row: UcpathJobRow) {
  const classified = classification.rows.find((entry) => entry.rowIndex === row.rowIndex);
  if (classified === undefined) {
    throw new Error(
      `the job-summary classification carries no row ${String(row.rowIndex)}; the two are derived from one `
      + "list, so this is a fabricated classification",
    );
  }
  return classified.tier;
}

/** The form names a title: that job wins over "the one active row", among active rows only, because a termination is never filed twice. */
function selectByTitle(
  rows: readonly UcpathJobRow[],
  classification: JobSummaryClassification,
  code: string,
): { row: UcpathJobRow } | Refusal {
  const matches = rows.filter((row) => row.jobCode.state === "present" && normalizeJobCode(row.jobCode.value) === code);
  if (matches.length > 0) {
    const open = matches.filter((row) => tierOf(classification, row) !== "inactive");
    const [only] = open;
    if (only === undefined) {
      return refuse("requested-employment-inactive", `the form names job ${code}, and UCPath shows that job is no `
        + `longer active (${describeRows(matches)}). Its termination may already be filed; this run files no second `
        + "one and ends no other job.");
    }
    if (open.length > 1) {
      return refuse("requested-title-ambiguous", `the form names job ${code}, and UCPath shows more than one `
        + `such job (${describeRows(open)}). The form does not say which position ends.`);
    }
    return statusChecked(only, classification, rows);
  }
  if (new Set(rows.map(jobKey)).size === 1) return selectWithoutTitle(rows, classification);
  const studentJobs = rows.filter((row) => isStudentJob(row) && tierOf(classification, row) !== "inactive");
  const [studentJob] = studentJobs;
  if (studentJobs.length === 1 && studentJob !== undefined) return statusChecked(studentJob, classification, rows);
  return refuse("requested-title-not-found", `the form names job ${code}, but UCPath shows ${describeRows(rows)}. `
    + "This run ends no job the form did not name.");
}

function statusChecked(
  row: UcpathJobRow,
  classification: JobSummaryClassification,
  rows: readonly UcpathJobRow[],
): { row: UcpathJobRow } | Refusal {
  const tier = tierOf(classification, row);
  if (tier === "active" || (tier === "not-shown" && rows.length === 1)) return { row };
  return refuse("indeterminate-employment-status", `UCPath rendered the job the form names with an HR status this `
    + `system does not recognize (${describeRows([row])}); a termination is filed only against a job known to be active.`);
}

function selectWithoutTitle(
  rows: readonly UcpathJobRow[],
  classification: JobSummaryClassification,
): { row: UcpathJobRow } | Refusal {
  if (classification.disposition === "indeterminate-status") {
    return refuse("indeterminate-employment-status", `UCPath rendered ${String(classification.unknownRowCount)} of `
      + `${String(classification.rowCount)} employment rows with an HR status this system does not `
      + `recognize (${describeRows(rows)}). "Is this person still employed" has no answer while one of `
      + "their employments does not, and a termination is filed against ONE of them.");
  }
  if (classification.disposition === "no-active-job") {
    return refuse("no-active-employment", `UCPath shows no active employment for this person (${describeRows(rows)}). `
      + "They may already be fully separated. There is no employment for this separation to end.");
  }
  if (classification.disposition === "concurrent-active-jobs") {
    return refuse("concurrent-active-employments", `UCPath shows ${String(classification.activeRowCount)} concurrent `
      + `active employments (${describeRows(rows)}), and the form names no Student Title Code that picks one. `
      + "Picking one would end an appointment nobody named.");
  }
  const selectedTier = classification.disposition === "sole-record" ? "not-shown" : "active";
  const row = rows.find((candidate) => tierOf(classification, candidate) === selectedTier);
  if (row === undefined) {
    throw new Error(
      "the job-summary classification reported exactly one selectable row and no grid row carries its "
      + "index; the two are derived from one list, so this is a fabricated classification",
    );
  }
  return { row };
}

function stageEmployment(active: UcpathJobRow, rowCount: number): EmploymentSelection {
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
      hrStatus: active.hrStatus.state === "present" ? active.hrStatus.value : `Not shown (${active.hrStatus.reason})`,
      businessUnit: active.businessUnit,
      deptId: active.deptId,
      department: active.department,
      payrollTitleCode: payrollTitleCode.data,
      payrollTitle: payrollTitle.data,
      effectiveDate: active.effectiveDate,
      rowCount,
    },
  });
}
