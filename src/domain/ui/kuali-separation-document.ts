/**
 * Kuali Build — the RRSS **Separation Request Form** read surface (D194 /
 * doc 01 §2.8).
 *
 * One page visit, one fixed strict output: everything the separation document
 * carries that a later composition could want, captured while we are standing
 * on the page. `docs/migrations/separations.md` §2.3 names six fields for
 * step 1; this returns the whole form because re-authoring a shipped output
 * schema moves a hash existing runs already bind.
 *
 * ## What is load-bearing here, and why
 *
 * - **The form TYPE is an output, not an assumption (S2).** Legacy discovers a
 *   non-separation document as a 5-second locator timeout on
 *   `Employee Last Name, First Name*` — "wrong form" and "slow page" are the
 *   same observation to it. Kuali's own document route sets
 *   `document.title` to `Form - <form name> - Kuali`, so the form's name is a
 *   first-class read, compared by VALUE, and a mismatch refuses by naming what
 *   was found.
 * - **Every field the operator may leave blank carries an explicit
 *   `{state:"absent", reason}` arm**, and that is the COMMON case, not an edge:
 *   of the three live documents observed 2026-08-12, doc 4502 carried a blank
 *   `Timekeeper Name:*`, `Termination Effective Date*`, `Payroll Title Code*`,
 *   `Payroll Title*` and `Transaction Number:*`, and a `Department*` sitting on
 *   its `- - -` sentinel. A rich read without absent arms would fail every
 *   unprocessed document.
 * - **A malformed non-blank value still refuses.** A date that is not
 *   `MM/DD/YYYY` and an EID field that holds something that is not an EID are
 *   both `unparseable-date` / `unreadable-eid` states, never a blank and never a
 *   guess (S8, and the charter's fail-loud rule).
 * - **Every dropdown's COMPLETE option list is returned as observed** (§3.2's
 *   MAP-EVERYTHING directive). The `Type of Termination*` list is what makes
 *   §4a's map exhaustive, and returning it per run is what turns "Kuali added an
 *   option" into a loud refusal instead of a silent misfile.
 * - **The termination type is returned VERBATIM and mapped nowhere here.** The
 *   `{template, reasonCode}` decision is pure domain
 *   (`src/domain/separations/termination-type.ts`), so a driver can never file
 *   a reason code.
 *
 * Live-mapped read-only 2026-08-12 against real documents 4510, 4502 and 4495
 * (Duo cleared hands-off by Duo Autopilot). Every recipe below resolved to
 * EXACTLY ONE node on that live accessibility tree.
 */
import { z } from "zod";
import {
  DateOnlySchema,
  EidSchema,
  ElementIdSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
} from "../ids.js";
import type { DateOnly } from "../ids.js";
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

/**
 * The document number the page itself displays — the SUBJECT of this read.
 *
 * The subject of a separation-document read is the DOCUMENT, not the person:
 * the run names a document and the EID is what the read discovers. Doc 01's
 * `artifact` subject kind with `identity:"document-id"` is exactly that shape,
 * and it is why this observation exists beside the person-subject
 * `kuali.rrss-document.displayed-eid` the write binding uses.
 */
export const KUALI_RRSS_DISPLAYED_NUMBER = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-number",
);
/** The form's own name, read off Kuali's document-route title (S2). */
export const KUALI_RRSS_DISPLAYED_FORM_TYPE = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-form-type",
);

/** The one form this workflow family reads. Compared by value, never assumed. */
export const KUALI_SEPARATION_FORM_TYPE = "RRSS Separation Request Form";

/* ── Field arms ───────────────────────────────────────────────────────────── */

/**
 * A free-text field. `absent` is a real, evidenced outcome — the control was
 * resolved and read, and it was empty — never "the read failed".
 */
export const KualiTextFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type KualiTextField = z.infer<typeof KualiTextFieldSchema>;

/** `MM/DD/YYYY`, as Kuali's date controls spell it (live 2026-08-12). */
export const KualiFormDateSchema = z.string().regex(
  /^\d{2}\/\d{2}\/\d{4}$/u,
  "a Kuali form date must be MM/DD/YYYY",
);

/**
 * A date field: the RAW string exactly as the control displays it, beside the
 * parsed calendar date. Both, because the raw is what an operator would see and
 * the parsed is what a later node computes on — and a reader who has only one
 * of them has to re-derive the other.
 */
export const KualiDateFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    raw: KualiFormDateSchema,
    value: DateOnlySchema,
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type KualiDateField = z.infer<typeof KualiDateFieldSchema>;

/**
 * `MM/DD/YYYY` → `YYYY-MM-DD`, or `null` when the string is not a real calendar
 * date.
 *
 * The rollover check is the point: `new Date("2026-02-31")` is a VALID `Date`
 * that silently means 3 March, so a form holding `02/31/2026` would parse into
 * a plausible-but-wrong separation date. Comparing the round-trip back to the
 * three fields is what turns that into a refusal.
 */
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

/**
 * A `<select>` field: the selected option's VISIBLE TEXT, verbatim. Kuali's
 * blank sentinel is the literal option `- - -`, which is an unset field and
 * therefore `absent` — not a value called `- - -`.
 */
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

/**
 * The UCPath transaction number a previous run (or a person) wrote back.
 *
 * THREE arms, not two, and the third is the point. This chunk does not consume
 * the value, so refusing the whole read over a hand-typed `pending` would block
 * a document nobody needs to fix; but folding "somebody typed prose here" into
 * `absent` would make "the field is empty" and "the field holds something we do
 * not recognise" the same durable fact, which is the conflation this program
 * bans everywhere else. So an unrecognised value keeps its raw text and says so.
 */
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

/**
 * The Final Pay radio group — all FOUR options, live-observed 2026-08-12.
 *
 * Legacy addresses exactly one of them and selects it unconditionally on every
 * separation (S58 / dangerous pattern D9, migration doc §4g). Reading which one
 * the document already carries is the fact that question needs, so it is an
 * output rather than something the write half discovers later.
 */
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
  /** S2: the form's own name, read and compared — never inferred from a timeout. */
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

/**
 * What `readSeparationDocument` returns.
 *
 * Every EXPECTED negative is its own arm with its own observed values, so the
 * task can map it to its own durable `FailureRecord.code` (D196: distinct
 * negatives are distinct error codes). Mechanical failures — a dead page, a
 * control that never rendered, an ambiguous match — still THROW out of the
 * driver; none of them may become one of these arms, because "the check failed"
 * must never read as "the document says so".
 */
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
  /** The action id opened a REAL document — a different one (D129). */
  z.strictObject({
    state: z.literal("document-number-mismatch"),
    actionId: KualiActionIdSchema,
    expectedNumber: KualiDocumentNumberSchema,
    observedNumber: KualiDocumentNumberSchema,
    observedAt: IsoInstantSchema,
  }),
  /** S2, answered by name instead of by a per-field timeout. */
  z.strictObject({
    state: z.literal("not-a-separation-document"),
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    observedFormType: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
  /** S8: a non-blank date the form spells in a way we do not understand. */
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
