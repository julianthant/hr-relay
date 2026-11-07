/** Kuali Build — the RRSS **Separation Request Form** read surface: one page visit, one fixed set of semantic reads, every option list complete. */
import { z } from "zod";
import {
  DateOnlySchema,
  EidSchema,
  ElementIdSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
} from "../../rules/identity/ids.js";
import type { DateOnly } from "../../rules/identity/ids.js";
import { KualiActionIdSchema, KualiDocumentNumberSchema } from "./kuali-document-identity.js";

/* ── Semantic ids ─────────────────────────────────────────────────────────── */

export const KUALI_RRSS_EMPLOYEE_NAME_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.employee-name-field",
);
export const KUALI_RRSS_LAST_DAY_WORKED_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.last-day-worked-field",
);
export const KUALI_RRSS_SEPARATION_DATE_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.separation-date-field",
);
export const KUALI_RRSS_TERMINATION_TYPE_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.termination-type-field",
);
export const KUALI_RRSS_LOCATION_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.location-field",
);
export const KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX = ElementIdSchema.parse(
  "kuali.rrss-document.request-acknowledged-checkbox",
);
export const KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.timekeeper-comments-field",
);
export const KUALI_RRSS_TERMINATION_EFF_DATE_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.termination-effective-date-field",
);
export const KUALI_RRSS_DEPARTMENT_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.department-field",
);
export const KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.payroll-title-code-field",
);
export const KUALI_RRSS_PAYROLL_TITLE_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.payroll-title-field",
);
export const KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX = ElementIdSchema.parse(
  "kuali.rrss-document.submitted-template-checkbox",
);
export const KUALI_RRSS_TRANSACTION_NUMBER_FIELD = ElementIdSchema.parse(
  "kuali.rrss-document.transaction-number-field",
);
export const KUALI_RRSS_FINAL_PAY_STUDENT_RADIO = ElementIdSchema.parse(
  "kuali.rrss-document.final-pay-student-radio",
);

/** The read's page state: the separation form is loaded AND proved to be one. */
export const KUALI_RRSS_SEPARATION_READY = PageStateIdSchema.parse(
  "kuali.rrss-document.separation-ready",
);

/** The document number the page itself displays — the SUBJECT of this read, because the subject of a separation-document read is the DOCUMENT, not the person. */
export const KUALI_RRSS_DISPLAYED_NUMBER = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-number",
);
/** Form identity comes from the document-route title. */
export const KUALI_RRSS_DISPLAYED_FORM_TYPE = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-form-type",
);

/** The one form this workflow family reads. Compared by value, never assumed. */
export const KUALI_SEPARATION_FORM_TYPE = "RRSS Separation Request Form";

/* ── Field arms ───────────────────────────────────────────────────────────── */

/** A free-text field; `absent` is a real, evidenced outcome — the control was read, and it was empty — never "the read failed". */
export const KualiTextFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type KualiTextField = z.infer<typeof KualiTextFieldSchema>;

/** `MM/DD/YYYY`, as Kuali's date controls spell it. */
export const KualiFormDateSchema = z.string().regex(
  /^\d{2}\/\d{2}\/\d{4}$/u,
  "a Kuali form date must be MM/DD/YYYY",
);

  /* A date field: the RAW string exactly as the control displays it, beside the parsed calendar date, because the raw is what an operator sees and the parsed is what a later node computes on. */
export const KualiDateFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    raw: KualiFormDateSchema,
    value: DateOnlySchema,
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type KualiDateField = z.infer<typeof KualiDateFieldSchema>;

/** `MM/DD/YYYY` → `YYYY-MM-DD`, or `null` when the string is not a real calendar date. */
export function parseKualiFormDate(raw: string): DateOnly | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(raw);
  if (match === null) return null;
  const [, month = "", day = "", year = ""] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)) return null;
  return DateOnlySchema.parse(iso);
}

/** A `<select>` field: the selected option's VISIBLE TEXT, verbatim; Kuali's blank sentinel is an unset field, not a value called `- - -`. */
export const KualiOptionFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type KualiOptionField = z.infer<typeof KualiOptionFieldSchema>;

/** Kuali's own "nothing selected" option text, observed live on every dropdown. */
export const KUALI_BLANK_OPTION_TEXT = "- - -";

export const KualiEidFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: EidSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type KualiEidField = z.infer<typeof KualiEidFieldSchema>;

/** The UCPath transaction number a previous run (or a person) wrote back; THREE arms, not two, and the third is the point. */
export const KualiTransactionNumberSchema = z.string().regex(
  /^T\d{6,12}$/u,
  "a UCPath transaction number is T followed by 6-12 digits",
);
export const KualiTransactionNumberFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: KualiTransactionNumberSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  z.strictObject({
    state: z.literal("unrecognized"),
    raw: z.string().min(1),
    reason: z.string().min(1),
  }),
]);
export type KualiTransactionNumberField = z.infer<typeof KualiTransactionNumberFieldSchema>;

/** The Final Pay radio group — all FOUR options, live-observed; the option the run stages names which one, and an absent arm is never selected by default. */
export const KualiFinalPayChoiceSchema = z.enum([
  "submitted-final-pay-request",
  "does-not-need-final-pay-student",
  "does-not-need-final-pay-transfer",
  "other",
]);
export type KualiFinalPayChoice = z.infer<typeof KualiFinalPayChoiceSchema>;

export const KualiFinalPaySelectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: KualiFinalPayChoiceSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type KualiFinalPaySelection = z.infer<typeof KualiFinalPaySelectionSchema>;

/** Every option list the form carries, verbatim and complete (§3.2). */
export const KualiSeparationOptionListsSchema = z.strictObject({
  terminationType: z.array(z.string().min(1)).min(1),
  division: z.array(z.string().min(1)).min(1),
  employeeType: z.array(z.string().min(1)).min(1),
  studentTitleCode: z.array(z.string().min(1)).min(1),
  department: z.array(z.string().min(1)).min(1),
  finalPay: z.array(z.string().min(1)).min(1),
});
export type KualiSeparationOptionLists = z.infer<typeof KualiSeparationOptionListsSchema>;

/* ── The read ─────────────────────────────────────────────────────────────── */

export const KualiSeparationDocumentSchema = z.strictObject({
  pageStateId: z.literal(KUALI_RRSS_SEPARATION_READY),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  /** Compare the observed form name; timeout cannot establish identity. */
  formType: z.strictObject({
    observed: z.literal(KUALI_SEPARATION_FORM_TYPE),
    matches: z.literal(true),
  }),
  employee: z.strictObject({
    /** `Last, First` as the form displays it, trimmed. No name normalization here. */
    name: KualiTextFieldSchema,
    eid: KualiEidFieldSchema,
    employeeType: KualiOptionFieldSchema,
    studentTitleCode: KualiOptionFieldSchema,
    division: KualiOptionFieldSchema,
    location: KualiTextFieldSchema,
  }),
  separation: z.strictObject({
    /** VERBATIM. The `{template, reasonCode}` decision is pure domain, not a read. */
    terminationType: KualiOptionFieldSchema,
    lastDayWorked: KualiDateFieldSchema,
    separationDate: KualiDateFieldSchema,
    additionalComments: KualiTextFieldSchema,
  }),
  timekeeper: z.strictObject({
    requestAcknowledged: z.boolean(),
    name: KualiTextFieldSchema,
    comments: KualiTextFieldSchema,
  }),
  finalTransactions: z.strictObject({
    terminationEffectiveDate: KualiDateFieldSchema,
    department: KualiOptionFieldSchema,
    payrollTitleCode: KualiTextFieldSchema,
    payrollTitle: KualiTextFieldSchema,
    submittedTerminationTemplate: z.boolean(),
    transactionNumber: KualiTransactionNumberFieldSchema,
    finalPay: KualiFinalPaySelectionSchema,
  }),
  options: KualiSeparationOptionListsSchema,
  observedAt: IsoInstantSchema,
});
export type KualiSeparationDocument = z.infer<typeof KualiSeparationDocumentSchema>;

/** What the read returns; every EXPECTED negative is its own arm with its own observed values, so a failure carries what the page actually showed. */
export const KualiSeparationDocumentReadSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("read"),
    document: KualiSeparationDocumentSchema,
  }),
  /** A stale action id, or a route that never rendered a document at all. */
  z.strictObject({
    state: z.literal("document-unavailable"),
    actionId: KualiActionIdSchema,
    observedUrl: z.string().min(1),
    reason: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
  /** The action id opened a REAL document — a different one. */
  z.strictObject({
    state: z.literal("document-number-mismatch"),
    actionId: KualiActionIdSchema,
    expectedNumber: KualiDocumentNumberSchema,
    observedNumber: KualiDocumentNumberSchema,
    observedAt: IsoInstantSchema,
  }),
  /** Form identity is answered by name, never field timeout. */
  z.strictObject({
    state: z.literal("not-a-separation-document"),
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    observedFormType: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
  /** The form contains an unrecognized nonblank date. */
  z.strictObject({
    state: z.literal("unparseable-date"),
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    field: z.enum(["lastDayWorked", "separationDate", "terminationEffectiveDate"]),
    raw: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("unreadable-eid"),
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    raw: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
]);
export type KualiSeparationDocumentRead = z.infer<typeof KualiSeparationDocumentReadSchema>;

export const ReadSeparationDocumentOperationSchema = z.custom<(
  input: Readonly<{ actionId: string; documentNumber: string }>,
) => Promise<KualiSeparationDocumentRead>>((value) => typeof value === "function");
