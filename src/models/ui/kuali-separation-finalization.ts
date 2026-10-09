import { ProtectedInputBindingsSchema } from "../write-safety/protected-input.js";
/** Stage all fields once, save once, then verify exact staged values after reload. */
import { z } from "zod";
import {
  EidSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
} from "../../rules/identity/ids.js";
import {
  KUALI_RRSS_TIMEKEEPER_FORM_KEY,
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "./kuali-document-identity.js";
import {
  KUALI_BLANK_OPTION_TEXT,
  KualiFinalPayChoiceSchema,
  KualiFormDateSchema,
  KualiTransactionNumberSchema,
} from "./kuali-separation-document.js";
import type { KualiFinalPayChoice } from "./kuali-separation-document.js";

/* ── Semantic ids ─────────────────────────────────────────────────────────── */

/** The document with every finalization field staged and nothing saved; structural only, because the read-back proves the values. */
export const KUALI_RRSS_FINALIZATION_STAGED = PageStateIdSchema.parse(
  "kuali.rrss-document.finalization-staged",
);

/** The document's Transaction Number, as displayed; it is the observation an ABSENCE of this write is sourced from. */
export const KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-transaction-number",
);

/* ── Value shapes ─────────────────────────────────────────────────────────── */

/** A single-line Kuali form value the automation may write: printable ASCII, bounded, never whitespace-padded, so every read trims and every comparison is against the trimmed form. */
function kualiFormText(max: number, label: string) {
  return z.string()
    .min(1)
    .max(max)
    .regex(/^[\x20-\x7E]+$/u, `${label} must be printable ASCII`)
    .refine((value) => value === value.trim(), `${label} may not be whitespace-padded`);
}

/** The exact VISIBLE TEXT of the `Department*` option to select — live shape `<6-digit code> - <description>`; resolving the department to this text is a pure upstream fold. */
export const KualiDepartmentOptionSchema = kualiFormText(160, "a Kuali department option")
  .refine(
    (value) => value !== KUALI_BLANK_OPTION_TEXT,
    `Kuali's blank sentinel ${JSON.stringify(KUALI_BLANK_OPTION_TEXT)} is an UNSET field, never a department`,
  );

export const KualiPayrollTitleCodeSchema = kualiFormText(32, "a Kuali payroll title code");
export const KualiPayrollTitleSchema = kualiFormText(160, "a Kuali payroll title");

/** The Timekeeper/Approver comments, in full; the control is read first so a write cannot clobber text a human wrote. */
export const KualiFinalizationCommentsSchema = z.string()
  .min(1)
  .max(4000)
  .refine((value) => value === value.trim(), "Kuali comments may not be whitespace-padded");

/* ── Variables, assertions, fields ────────────────────────────────────────── */

/** The per-run staged VARIABLES: every one of them is a value some earlier node already read or computed, and nothing here may be derived at fill time. */
export const KualiFinalizationVariablesSchema = z.strictObject({
  department: KualiDepartmentOptionSchema,
  payrollTitleCode: KualiPayrollTitleCodeSchema,
  payrollTitle: KualiPayrollTitleSchema,
  timekeeperName: KualiTimekeeperNameSchema,

  lastDayWorked: KualiFormDateSchema,
  separationDate: KualiFormDateSchema,
  terminationEffectiveDate: KualiFormDateSchema,
  transactionNumber: KualiTransactionNumberSchema,
  timekeeperComments: KualiFinalizationCommentsSchema,
    /* What the read saw in the comments control, verbatim (`""` when the control was empty). */
  observedExistingComments: z.string().max(4000),
});
export type KualiFinalizationVariables = z.infer<typeof KualiFinalizationVariablesSchema>;

/** The three values this workflow writes unconditionally; `finalPay` is the operator's recorded answer, written as that answer requires. */
export const KUALI_FINALIZATION_ASSERTIONS = Object.freeze({
  requestAcknowledged: true,
  submittedTerminationTemplate: true,
  finalPay: "does-not-need-final-pay-student",
} as const satisfies Readonly<{
  requestAcknowledged: boolean;
  submittedTerminationTemplate: boolean;
  finalPay: KualiFinalPayChoice;
}>);

/** The COMPLETE set of values one finalization save writes — the unit the prepare stages, the commit's wire proof asserts, and the verifier compares the reloaded document against. */
export const KualiFinalizationFieldsSchema = z.strictObject({
  department: KualiDepartmentOptionSchema,
  payrollTitleCode: KualiPayrollTitleCodeSchema,
  payrollTitle: KualiPayrollTitleSchema,
  requestAcknowledged: z.boolean(),
  timekeeperName: KualiTimekeeperNameSchema,
  lastDayWorked: KualiFormDateSchema,
  separationDate: KualiFormDateSchema,
  terminationEffectiveDate: KualiFormDateSchema,
  submittedTerminationTemplate: z.boolean(),
  transactionNumber: KualiTransactionNumberSchema,
  finalPay: KualiFinalPayChoiceSchema,
  timekeeperComments: KualiFinalizationCommentsSchema,
});
export type KualiFinalizationFields = z.infer<typeof KualiFinalizationFieldsSchema>;

export const KualiFinalizationFieldNameSchema = z.enum([
  "department",
  "payrollTitleCode",
  "payrollTitle",
  "requestAcknowledged",
  "timekeeperName",
  // Group reconciliation dates together so mismatch reports describe one comparison.
  "lastDayWorked",
  "separationDate",
  "terminationEffectiveDate",
  "submittedTerminationTemplate",
  "transactionNumber",
  "finalPay",
  "timekeeperComments",
]);
export type KualiFinalizationFieldName = z.infer<typeof KualiFinalizationFieldNameSchema>;

/** The field order every fill, read-back and mismatch report walks. */
export const KUALI_FINALIZATION_FIELD_NAMES: readonly KualiFinalizationFieldName[] = Object.freeze(
  KualiFinalizationFieldNameSchema.options,
);

/** Variables + assertions → the whole field set: a pure fold, so the prepare, the probe and the verifier derive the SAME expectation from the same run input. */
export function kualiFinalizationFields(
  variables: KualiFinalizationVariables,
): KualiFinalizationFields {
  return KualiFinalizationFieldsSchema.parse({
    department: variables.department,
    payrollTitleCode: variables.payrollTitleCode,
    payrollTitle: variables.payrollTitle,
    requestAcknowledged: KUALI_FINALIZATION_ASSERTIONS.requestAcknowledged,
    timekeeperName: variables.timekeeperName,
    lastDayWorked: variables.lastDayWorked,
    separationDate: variables.separationDate,
    terminationEffectiveDate: variables.terminationEffectiveDate,
    submittedTerminationTemplate: KUALI_FINALIZATION_ASSERTIONS.submittedTerminationTemplate,
    transactionNumber: variables.transactionNumber,
    finalPay: KUALI_FINALIZATION_ASSERTIONS.finalPay,
    timekeeperComments: variables.timekeeperComments,
  });
}

/** What the page ACTUALLY shows, in the same twelve slots; deliberately permissive in shape where the field set is strict, so a comparison failure names a field rather than a shape. */
export const KualiObservedFinalizationFieldsSchema = z.strictObject({
  department: z.string(),
  payrollTitleCode: z.string(),
  payrollTitle: z.string(),
  requestAcknowledged: z.boolean(),
  timekeeperName: z.string(),
  lastDayWorked: z.string(),
  separationDate: z.string(),
  terminationEffectiveDate: z.string(),
  submittedTerminationTemplate: z.boolean(),
  transactionNumber: z.string(),
  finalPay: KualiFinalPayChoiceSchema.nullable(),
  timekeeperComments: z.string(),
});
export type KualiObservedFinalizationFields = z.infer<typeof KualiObservedFinalizationFieldsSchema>;

export const KualiFinalizationMismatchSchema = z.strictObject({
  field: KualiFinalizationFieldNameSchema,
  expected: z.string(),
  observed: z.string(),
});
export type KualiFinalizationMismatch = z.infer<typeof KualiFinalizationMismatchSchema>;

/** Rendered so a boolean `false`, an empty string and an unselected radio are distinguishable in a report. */
function renderFieldValue(value: string | boolean | null): string {
  if (value === null) return "<none selected>";
  if (typeof value === "boolean") return value ? "checked" : "unchecked";
  return value.length === 0 ? "<empty>" : value;
}

/** Field-by-field comparison of what the page shows against what was staged: exact equality on every field, with no tolerance arm anywhere. */
export function compareKualiFinalizationFields(
  expected: KualiFinalizationFields,
  observed: KualiObservedFinalizationFields,
): readonly KualiFinalizationMismatch[] {
  const mismatches: KualiFinalizationMismatch[] = [];
  for (const field of KUALI_FINALIZATION_FIELD_NAMES) {
    const want = expected[field];
    const got = observed[field];
    if (want === got) continue;
    mismatches.push(KualiFinalizationMismatchSchema.parse({
      field,
      expected: renderFieldValue(want),
      observed: renderFieldValue(got),
    }));
  }
  return Object.freeze(mismatches);
}

/* ── The `formKey` table, and what a key alone does NOT buy ───────────────── */

/** Mutation formKey and DOM control ID are unrelated identifiers. */
export const KUALI_RRSS_FINALIZATION_FORM_KEYS: Readonly<
  Record<KualiFinalizationFieldName, string | null>
> = Object.freeze({
  department: "JPYGckVxcf",
  payrollTitleCode: "2FlOeR5pd9",
  payrollTitle: "sVmpq6tG9X",
  requestAcknowledged: "xKRU6vmYSY",
  timekeeperName: KUALI_RRSS_TIMEKEEPER_FORM_KEY,
  lastDayWorked: "ER1WhBzjcm",
  separationDate: "oEcp1xtQkj",
  terminationEffectiveDate: "DoWSfJhpRm",
  submittedTerminationTemplate: "6Ejy-1rfQJ",
  transactionNumber: "wPyuyY0wT0",
  finalPay: "8CXaCSIvx5",
  timekeeperComments: "J_upFRq074",
});

/** The fields whose `formKey` this repository has never observed — the list the next live `ActionPage` read closes. */
export function kualiFinalizationFormKeysMissing(): readonly KualiFinalizationFieldName[] {
  return Object.freeze(
    KUALI_FINALIZATION_FIELD_NAMES.filter(
      (field) => KUALI_RRSS_FINALIZATION_FORM_KEYS[field] === null,
    ),
  );
}

/** The fields whose wire value IS the staged string, so the save's payload check can compare them with no invented transformation. */
export const KUALI_RRSS_FINALIZATION_WIRE_ASSERTED: readonly KualiFinalizationFieldName[] =
  Object.freeze([
    "payrollTitleCode",
    "payrollTitle",
    "timekeeperName",
    "transactionNumber",
    "timekeeperComments",
  ]);

/** The fields whose wire value is not asserted — every gadget kind whose model value is not the staged string; all twelve `formKey`s are known, but seven still cannot be checked. */
export function kualiFinalizationWireUnasserted(): readonly KualiFinalizationFieldName[] {
  return Object.freeze(
    KUALI_FINALIZATION_FIELD_NAMES.filter(
      (field) => !KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.includes(field),
    ),
  );
}

/* ── The write's records ──────────────────────────────────────────────────── */

/** The run's whole address for this write: the document, the person, and the variables. */
export const KualiFinalizationTargetSchema = z.strictObject({
  protectedBindings: ProtectedInputBindingsSchema.optional(),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  emplId: EidSchema,
  variables: KualiFinalizationVariablesSchema,
});
export type KualiFinalizationTarget = z.infer<typeof KualiFinalizationTargetSchema>;

/** The typed saved-state proof for the `save-verify` completion arm; it names the document, the subject the page displayed, and the EXACT field set. */
export const KualiSavedFinalizationProofSchema = z.strictObject({
  kind: z.literal("kuali-saved-finalization"),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  observedEid: EidSchema,
  fields: KualiFinalizationFieldsSchema,
  source: z.literal("reload-read-back"),
});
export type KualiSavedFinalizationProof = z.infer<typeof KualiSavedFinalizationProofSchema>;

/** What the prepare proves; `stagedPageState` is required BY NAME, because the write sequencer binds the proof to the exact staged page and refuses a prepare output that cannot name one. */
export const KualiFinalizationStagingSchema = z.strictObject({
  stagedPageState: z.literal(KUALI_RRSS_FINALIZATION_STAGED),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  observedEid: EidSchema,
  previousFields: KualiObservedFinalizationFieldsSchema,
  stagedFields: KualiFinalizationFieldsSchema,
  observedDepartmentOptions: z.array(z.string().min(1)).min(1),
  observedAt: IsoInstantSchema,
});
export type KualiFinalizationStaging = z.infer<typeof KualiFinalizationStagingSchema>;

/** The reload read-back; `absent` means the reloaded document deterministically shows something ELSE, never that the reload failed. */
export const KualiFinalizationReadBackSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    proof: KualiSavedFinalizationProofSchema,
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("absent"),
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    observedEid: EidSchema,
    observedFields: KualiObservedFinalizationFieldsSchema,
    mismatches: z.array(KualiFinalizationMismatchSchema).min(1),
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("unknown"),
    reason: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
]);
export type KualiFinalizationReadBack = z.infer<typeof KualiFinalizationReadBackSchema>;

/* ── Typed driver refusals ────────────────────────────────────────────────── */

/** The live `Department*` control does not offer the option this run staged; the refusal is the sound one, because saving with the required field blank is worse. */
export class KualiDepartmentOptionNotOfferedError extends Error {
  readonly requested: string;
  readonly observedOptions: readonly string[];
  constructor(input: Readonly<{
    documentNumber: string;
    requested: string;
    observedOptions: readonly string[];
  }>) {
    super(
      `Kuali document ${input.documentNumber} does not offer the department option `
      + `${JSON.stringify(input.requested)}; the ${String(input.observedOptions.length)} options it did `
      + "offer are recorded on this run. Refusing to save a separation against a department the "
      + "control never carried.",
    );
    this.name = "KualiDepartmentOptionNotOfferedError";
    this.requested = input.requested;
    this.observedOptions = Object.freeze([...input.observedOptions]);
  }
}

/** The comments control no longer holds what the read saw, so the staged text was composed against text that has since moved; saving it would blank somebody's edit. */
export class KualiCommentsChangedError extends Error {
  readonly expected: string;
  readonly observed: string;
  constructor(input: Readonly<{ documentNumber: string; expected: string; observed: string }>) {
    super(
      `Kuali document ${input.documentNumber} now holds different Timekeeper/Approver comments than the `
      + "read this run composed its comments from; the staged text would overwrite an edit made in "
      + "between. Refusing to save.",
    );
    this.name = "KualiCommentsChangedError";
    this.expected = input.expected;
    this.observed = input.observed;
  }
}

/** A staged control did not read back the value it was given; nothing is saved and no partial write is attempted. */
export class KualiFinalizationStageNotPersistedError extends Error {
  readonly mismatches: readonly KualiFinalizationMismatch[];
  constructor(input: Readonly<{
    documentNumber: string;
    mismatches: readonly KualiFinalizationMismatch[];
  }>) {
    super(
      `Kuali document ${input.documentNumber} did not accept `
      + `${String(input.mismatches.length)} staged finalization value(s): `
      + input.mismatches
        .map((entry) => `${entry.field} reads ${JSON.stringify(entry.observed)}, staged ${JSON.stringify(entry.expected)}`)
        .join("; ")
      + ". Refusing to reach the fence on a staging the page did not take.",
    );
    this.name = "KualiFinalizationStageNotPersistedError";
    this.mismatches = Object.freeze([...input.mismatches]);
  }
}

/** Kuali STATED a refusal for the save — a transport failure, a GraphQL `errors` array, a `status` other than `Ok`, or non-null `validations`. */
export class KualiSaveRefusedError extends Error {
  readonly refusal: string;
  constructor(input: Readonly<{ documentNumber: string; refusal: string }>) {
    super(`Kuali refused the save on document ${input.documentNumber}: ${input.refusal}`);
    this.name = "KualiSaveRefusedError";
    this.refusal = input.refusal;
  }
}

/* ── Driver operation seams ───────────────────────────────────────────────── */

export const StageSeparationFinalizationOperationSchema = z.custom<(
  input: KualiFinalizationTarget,
) => Promise<KualiFinalizationStaging>>((value) => typeof value === "function");

export const ReadSavedSeparationFinalizationOperationSchema = z.custom<(
  input: KualiFinalizationTarget,
) => Promise<KualiFinalizationReadBack>>((value) => typeof value === "function");
