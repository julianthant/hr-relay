/**
 * Kuali Build — the RRSS **Separation Request Form** FINALIZATION write surface
 * (`docs/migrations/separations.md` §4e, chunk 5).
 *
 * ## The staged-variables model, stated once
 *
 * §4e's answer is the whole design of this module and it is not a preference:
 *
 *  1. every read lands first as a typed checkpoint — a "variable";
 *  2. ONE prepare stages **every** Kuali field in one pass from those variables
 *     — never re-read off the page, never recomputed at fill time;
 *  3. ONE save;
 *  4. ONE reload read-back that verifies **every** written field against the
 *     **exact staged variables** — not a fresh derivation, and not the page's
 *     own echo.
 *
 * So the unit this module is built around is `KualiFinalizationFields`: the
 * complete set of values one save writes. The prepare stages it, the commit's
 * wire proof asserts it, and the verifier compares the reloaded document
 * against it field by field. Nothing anywhere takes a shortcut through "the
 * page said so".
 *
 * ## Variables versus assertions
 *
 * Nine of the twelve values are genuine per-run VARIABLES. Three are
 * unconditional business assertions that legacy also writes unconditionally,
 * and they are constants here rather than inputs so that a caller cannot
 * quietly vary them:
 *
 *  - `requestAcknowledged` — legacy checks *Request Acknowledged* on every
 *    separation (`legacy:src/workflows/separations/steps/kronos-search.ts`,
 *    step 10b of the behavior review's flow table).
 *  - `submittedTerminationTemplate` — legacy checks *Submitted Termination
 *    Template* on every finalization (step 16).
 *  - `finalPay` — **§4g, operator-ratified 2026-08-12.** *Does not need Final
 *    Pay (student employee)* is asserted correct on every RRSS separation this
 *    workflow files. Option A (derive it from the Job Summary) was rejected
 *    because there is no rule to derive it from. The residual risk is named in
 *    §4g and accepted: an RRSS separation for someone the assertion does not
 *    cover writes that answer silently. S58's actual objection was that legacy
 *    carries the constant with no comment and no test — this comment, and
 *    `KUALI_FINALIZATION_ASSERTIONS`' own unit test, are what answer it.
 *
 * ## `Last Day Worked` / `Separation Date` ARE here — §4e's amendment, 2026-08-14
 *
 * They were not, and 5a recorded the gap rather than inventing a rule for it
 * (§9.10 judgement 3, and the orchestrator's disposition that they stay
 * unstaged). The operator answered the question on 2026-08-14, verbatim:
 *
 * > *"so what we are doing here is to collect all data first and then fill in
 * > the forms at the end."*
 *
 * That is the staged-variables model applied to legacy's step-13 date
 * write-backs, so the model does not change and the staged set grows by two.
 * Both are staged from the RECONCILED variables — the `dates` node's own
 * `lastDayWorked` and `separationDate` — never re-read off the page and never
 * recomputed at fill time, exactly like the other ten.
 *
 * **Both are staged UNCONDITIONALLY**, which is the honest form under one-pass
 * staging even though legacy writes them only when reconciliation moved them.
 * Legacy's condition is a property of its INCREMENTAL drafts: it saves the
 * document several times across its flow and touches a control only when it has
 * a reason to. Here there is ONE pass and ONE read-back, and the read-back
 * compares against the exact staged variables — so a conditionally staged field
 * would need an expectation composed from the page's own prior value, which is
 * the re-read §4e forbids. When nothing moved the reconciled value EQUALS what
 * the document already carried, so the unconditional save writes the same
 * string back and the read-back proves it either way.
 *
 * ## Anchors
 *
 * Every control this surface writes is ALREADY a registered element. Ten of the
 * twelve are live-verified EDITABLE — `exactly-one-editable` at
 * `verifiedAt: 2026-08-14` in `evidence/ui/kuali/separation-document.live.json`
 * (chunk 5c, §9.12 item 3), with `timekeeper-field` carrying D135's stronger
 * controlled-commit evidence instead.
 *
 * **The two date controls this amendment adds are NOT among them.** 5c verified
 * ten controls because ten were staged; `kuali.rrss-document.last-day-worked-field`
 * and `kuali.rrss-document.separation-date-field` carry `exactly-one-visible`
 * only, from the 2026-08-12 read-only pass — and *a selector mapped on a
 * read-only record is not a verified selector for the editable page* is exactly
 * the legacy lesson that arm exists to answer (D208). So both write paths in the
 * driver carry a `live-verify: next-live-pass` marker, and §9.15 names what that
 * pass owes: their editability, their `formKey`s, and the `sectionSettings` of
 * the section that owns them.
 */
import { z } from "zod";
import {
  EidSchema,
  IsoInstantSchema,
  ObservationIdSchema,
  PageStateIdSchema,
} from "../ids.js";
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

/**
 * The document with every finalization field staged and nothing saved.
 *
 * Structural only, exactly like `kuali.rrss-document.timekeeper-staged`: that
 * the controls hold the STAGED values is proved by the prepare's own read-back,
 * not by a page-state rule — a value-dependent state id would be a different
 * state per run and could not be registered at all.
 */
export const KUALI_RRSS_FINALIZATION_STAGED = PageStateIdSchema.parse(
  "kuali.rrss-document.finalization-staged",
);

/**
 * The document's Transaction Number, as displayed.
 *
 * It is the observation an ABSENCE of this write is sourced from, because it is
 * the half of the permanent key the document itself carries: the key asks "is
 * document N already finalized against transaction T?", and this control is
 * where T would be. The full verdict still compares all twelve fields — this names
 * where the decisive one is read.
 */
export const KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER = ObservationIdSchema.parse(
  "kuali.rrss-document.displayed-transaction-number",
);

/* ── Value shapes ─────────────────────────────────────────────────────────── */

/**
 * A single-line Kuali form value the automation may write: printable ASCII,
 * bounded, never whitespace-padded. Kuali inputs return padded values (legacy
 * `kuali/LESSONS.md:49-54`), so every read trims and every comparison is
 * against the trimmed form — a schema that accepted a padded value would make
 * "what we staged" and "what the page reads back" unequal by construction.
 */
function kualiFormText(max: number, label: string) {
  return z.string()
    .min(1)
    .max(max)
    .regex(/^[\x20-\x7E]+$/u, `${label} must be printable ASCII`)
    .refine((value) => value === value.trim(), `${label} may not be whitespace-padded`);
}

/**
 * The exact VISIBLE TEXT of the `Department*` option to select — live shape
 * `<6-digit code> - <description>` (§9.3's S55 capture). Resolving a UCPath
 * department description to this text is a pure upstream fold; by the time it
 * reaches this surface it is a variable, and the driver's only job is to refuse
 * an option the live control does not offer (S55).
 */
export const KualiDepartmentOptionSchema = kualiFormText(160, "a Kuali department option")
  .refine(
    (value) => value !== KUALI_BLANK_OPTION_TEXT,
    `Kuali's blank sentinel ${JSON.stringify(KUALI_BLANK_OPTION_TEXT)} is an UNSET field, never a department`,
  );

export const KualiPayrollTitleCodeSchema = kualiFormText(32, "a Kuali payroll title code");
export const KualiPayrollTitleSchema = kualiFormText(160, "a Kuali payroll title");

/**
 * The Timekeeper/Approver comments, in full.
 *
 * Legacy APPENDS to this control and refuses to save when it cannot read the
 * existing text, because blanking a human's prior comments is worse than
 * failing (**S56**). The staged-variables model moves that composition upstream:
 * the value here is the COMPLETE final text, composed by the caller from
 * chunk 2's `timekeeper.comments` read plus whatever this run appends. Newlines
 * are legal — a comments field is not a single-line control — but the value is
 * still trimmed, so the staged text and the reloaded text compare exactly.
 */
export const KualiFinalizationCommentsSchema = z.string()
  .min(1)
  .max(4000)
  .refine((value) => value === value.trim(), "Kuali comments may not be whitespace-padded");

/* ── Variables, assertions, fields ────────────────────────────────────────── */

/**
 * The per-run staged VARIABLES — §4e's list, minus the three unconditional
 * assertions below. Every one of them is a value some earlier node already read
 * or computed; nothing here may be derived at fill time.
 */
export const KualiFinalizationVariablesSchema = z.strictObject({
  department: KualiDepartmentOptionSchema,
  payrollTitleCode: KualiPayrollTitleCodeSchema,
  payrollTitle: KualiPayrollTitleSchema,
  timekeeperName: KualiTimekeeperNameSchema,
  /**
   * §4e's amendment of 2026-08-14 — legacy's step-13 write-backs, as staged
   * variables.
   *
   * Both come from the `dates` node's RECONCILED output and from nowhere else:
   * `lastDayWorked` is the New Kronos last punch and `separationDate` is
   * `max(lastDayWorked, last sick, last holiday)`. They are the values the
   * operator approved at the gate (they ride in D211's write plan), so staging
   * them re-reads nothing and re-derives nothing. Unconditional by design — see
   * the module header.
   */
  lastDayWorked: KualiFormDateSchema,
  separationDate: KualiFormDateSchema,
  terminationEffectiveDate: KualiFormDateSchema,
  transactionNumber: KualiTransactionNumberSchema,
  timekeeperComments: KualiFinalizationCommentsSchema,
  /**
   * What chunk 2's read saw in the comments control, verbatim (`""` when the
   * control was empty).
   *
   * The prepare refuses when the live control no longer holds this. That is
   * **S56 strengthened, not re-derived**: legacy refuses only when the read
   * THROWS, so a human who typed a note between the read and the write silently
   * loses it. Re-reading here decides a REFUSAL, never a value — the staged
   * comments text is still the caller's, unchanged.
   */
  observedExistingComments: z.string().max(4000),
});
export type KualiFinalizationVariables = z.infer<typeof KualiFinalizationVariablesSchema>;

/**
 * The three values this workflow writes unconditionally. See the module header
 * for each one's ratification; `finalPay` is §4g's operator answer of
 * 2026-08-12, recorded in code as that answer requires.
 */
export const KUALI_FINALIZATION_ASSERTIONS = Object.freeze({
  requestAcknowledged: true,
  submittedTerminationTemplate: true,
  finalPay: "does-not-need-final-pay-student",
} as const satisfies Readonly<{
  requestAcknowledged: boolean;
  submittedTerminationTemplate: boolean;
  finalPay: KualiFinalPayChoice;
}>);

/**
 * The COMPLETE set of values one finalization save writes — the unit the
 * prepare stages, the commit's wire proof asserts, and the verifier compares
 * the reloaded document against.
 */
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
  // The three dates sit together on purpose: a mismatch report that names two
  // of them reads as one fact about the reconciliation, not as two unrelated
  // controls. The page's own order is different and is not what this list is.
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

/**
 * Variables + assertions → the whole field set. A pure fold, so the prepare, the
 * probe and the verifier all derive the SAME expectation from the same run
 * input and cannot disagree about what was supposed to be written.
 */
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

/**
 * What the page ACTUALLY shows, in the same twelve slots.
 *
 * Deliberately permissive where the field set is strict: an unprocessed
 * document sits on `- - -`, holds `""` in five controls and has no Final Pay
 * radio selected at all (§9.3's doc 4502), and every one of those is a real
 * observation this shape must be able to carry. Refusing to PARSE the page is
 * how a genuine "the write did not land" turns into an unreadable `unknown`.
 *
 * The two date write-backs are permissive for a second reason: they are
 * REQUIRED controls a live document normally already carries, so their ordinary
 * observation is a well-formed date that may simply disagree with the
 * reconciled one — which is a mismatch to report, never a parse to refuse.
 */
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

/**
 * Field-by-field comparison of what the page shows against what was staged.
 *
 * **Exact equality on every field, with no tolerance arm anywhere.** §4e says
 * the read-back verifies against "the exact staged variables", and every
 * near-miss this could absorb is a real defect: a trimmed date is a different
 * date, a department option that merely CONTAINS the code is a different
 * department, and a comments field that kept only a prefix has dropped
 * somebody's note. The result is the ordered list of everything that
 * disagreed — never a boolean — so a refusal can name the field.
 */
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

/**
 * The `formKey` each finalization gadget is serialized under in Kuali's own
 * `submitDocumentV2` mutation — NOT the control's DOM id. A Kuali Build gadget
 * carries both and they are unrelated strings (`timekeeperName` is `QGJ63YrCom`
 * on the wire and `BWmkKqx40` in the DOM), so a payload check written against
 * the DOM id would never match anything.
 *
 * **Ten of the twelve were captured live 2026-08-14** (chunk 5c, `docs/migrations/
 * separations.md` §9.12) off Kuali's own `ActionPage` GraphQL query — the read
 * the app itself issues when a document route opens, observed passively with
 * nothing extra sent. The extraction was validated against the one key this
 * repository already knew: `timekeeperName` came back `QGJ63YrCom`, byte-identical
 * to the 2026-08-04 capture that D135 then confirmed on the wire.
 *
 * **The two date write-backs §4e's 2026-08-14 amendment added are `null`,** because
 * 5c captured the ten fields that were staged then and this repository has never
 * seen the other two on any wire. `null` rather than a guess: a fabricated key
 * makes the commit's wire proof a check that cannot fail, which is the same
 * defect as one that can only fail. `kualiFinalizationFormKeysMissing()` is the
 * to-do list and §9.15 names the pass that closes it — the same passive
 * `ActionPage` read, which costs nothing and sends nothing.
 */
export const KUALI_RRSS_FINALIZATION_FORM_KEYS: Readonly<
  Record<KualiFinalizationFieldName, string | null>
> = Object.freeze({
  department: "JPYGckVxcf",
  payrollTitleCode: "2FlOeR5pd9",
  payrollTitle: "sVmpq6tG9X",
  requestAcknowledged: "xKRU6vmYSY",
  timekeeperName: KUALI_RRSS_TIMEKEEPER_FORM_KEY,
  lastDayWorked: null,
  separationDate: null,
  terminationEffectiveDate: "DoWSfJhpRm",
  submittedTerminationTemplate: "6Ejy-1rfQJ",
  transactionNumber: "wPyuyY0wT0",
  finalPay: "8CXaCSIvx5",
  timekeeperComments: "J_upFRq074",
});

/**
 * The fields whose `formKey` this repository has never observed — the list the
 * next live `ActionPage` read closes.
 *
 * It is deliberately derived from the table rather than written beside it: a
 * hand-maintained second list is one that can disagree with the table it
 * describes.
 */
export function kualiFinalizationFormKeysMissing(): readonly KualiFinalizationFieldName[] {
  return Object.freeze(
    KUALI_FINALIZATION_FIELD_NAMES.filter(
      (field) => KUALI_RRSS_FINALIZATION_FORM_KEYS[field] === null,
    ),
  );
}

/**
 * The fields whose wire value IS the staged string, so the save's payload check
 * can compare them with no invented transformation.
 *
 * ## Why this set is five and not twelve — the thing 5c's live pass actually found
 *
 * Kuali's `submitDocumentV2` sends the whole document MODEL keyed by `formKey`,
 * and the model does not hold twelve strings. Read off the live model of real docs
 * 4510 / 4495 / 4502 on 2026-08-14:
 *
 * | gadget | field(s) | model value |
 * |---|---|---|
 * | `Text` / `Textarea` | the five below | the plain string |
 * | `Dropdown` | `department` | `{"id":"GfKti1EX5VL","label":"000412 - Housing/Dining/Hospitality"}` |
 * | `Date` | `terminationEffectiveDate` | `1781136000000` — epoch ms at UTC midnight |
 * | `Checkboxes` | `requestAcknowledged`, `submittedTerminationTemplate` | `[{"id":"5ZaHvv-OLS","label":"Request Acknowledged - In Progress"}]` |
 * | `Radios` | `finalPay` | `{"id":"s9ziHeMcl","label":"Does not need Final Pay (student employee)"}` |
 *
 * So filling the key table was necessary and not sufficient: asserting
 * `data[formKey] === "06/19/2026"` for a `Date`, or `=== "000412 - …"` for a
 * `Dropdown`, is a check that can only fail — it would turn every landed save
 * into a post-fence park. Deriving the expected value instead needs a
 * transformation this repository has **never observed on the write wire**, and
 * for the option-bearing gadgets it needs an option-id table Kuali can
 * republish. One live fact makes that concrete: the `Department*` option
 * `000719 -  Supply Chain Services` carries a DOUBLE space in Kuali's model and
 * the driver reads it through `HTMLOptionElement.text`, which collapses
 * whitespace — so a label comparison there is already provably wrong.
 *
 * The unasserted five are therefore **recorded, not asserted**, which is the
 * same discipline that kept them `null` before: a comparison whose expected
 * value has to be invented is not a check. The landing proof is unaffected and
 * always was — `readSavedSeparationFinalization`'s reload read-back compares all
 * twelve fields, and `submitDocumentV2` answers `{"status":"Ok","validations":null}`
 * for a mutation that dropped a field entirely. What moved is the earlier,
 * louder half of the defence: from one field to five. **The controlled commit
 * (§4f2's canary) is what closes the rest**, because it is the first time this
 * repository will see the real payload.
 *
 * §4e's 2026-08-14 amendment added two more unasserted fields for a DIFFERENT
 * reason — their `formKey` is not known at all — and they would be unassertable
 * anyway, because a Kuali `Date` gadget holds epoch milliseconds on the wire,
 * not the `MM/DD/YYYY` string that is staged. `kualiFinalizationFormKeysMissing()`
 * keeps the two reasons distinguishable.
 */
export const KUALI_RRSS_FINALIZATION_WIRE_ASSERTED: readonly KualiFinalizationFieldName[] =
  Object.freeze([
    "payrollTitleCode",
    "payrollTitle",
    "timekeeperName",
    "transactionNumber",
    "timekeeperComments",
  ]);

/**
 * The fields whose wire value is NOT asserted — the four gadget kinds whose
 * model value is not the staged string, plus the two whose `formKey` this
 * repository has never observed.
 */
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
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  emplId: EidSchema,
  variables: KualiFinalizationVariablesSchema,
});
export type KualiFinalizationTarget = z.infer<typeof KualiFinalizationTargetSchema>;

/**
 * The typed saved-state proof for doc 09's `save-verify` completion arm.
 *
 * It names the document, the subject the page displayed, and the EXACT field
 * set that was found on it. It carries no "clicked ok" flag by design: the only
 * thing that promotes a claim to proof is a reload read-back returning this
 * shape with `source:"reload-read-back"`.
 */
export const KualiSavedFinalizationProofSchema = z.strictObject({
  kind: z.literal("kuali-saved-finalization"),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  observedEid: EidSchema,
  fields: KualiFinalizationFieldsSchema,
  source: z.literal("reload-read-back"),
});
export type KualiSavedFinalizationProof = z.infer<typeof KualiSavedFinalizationProofSchema>;

/**
 * What the prepare proves. `stagedPageState` is required BY NAME: the write
 * sequencer reads it to bind the binding proof to the exact staged page and
 * refuses a prepare output that cannot name one.
 *
 * `previousFields` is the operator's undo record — every value the document
 * held before this run touched it — and `observedDepartmentOptions` is §3.2's
 * MAP-EVERYTHING obligation discharged at write time, so a control that
 * republished its option list is visible on the run rather than only on the
 * next read.
 */
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

/**
 * The reload read-back.
 *
 * `absent` means the reloaded document deterministically shows something ELSE —
 * a real, evidenced negative that names every disagreeing field. `unknown`
 * covers every "the check itself failed" case and can never become retry
 * authority. There is no boolean and no third meaning of "not sure".
 */
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

/**
 * **S55.** The live `Department*` control does not offer the option this run
 * staged. Legacy throws here too and that refusal is the sound one — saving
 * with the required field blank is worse — but legacy discovers it by matching
 * loosely; this one carries the COMPLETE observed option list so the run
 * records what the control actually offered.
 *
 * It is a TYPE, not a message, because the task must be able to turn exactly
 * this into `department-option-not-offered` and nothing else into it.
 */
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

/**
 * **S56, strengthened.** The comments control no longer holds what chunk 2's
 * read saw, so the staged text was composed against text that has since moved
 * and saving it would blank somebody's edit.
 */
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

/**
 * A staged control did not read back the value it was given — the
 * `fillWithVerify` discipline (legacy `kuali/navigate.ts:16-39`), which exists
 * because Kuali controls silently drop a `fill()`. Nothing is saved and no
 * fence exists when this is thrown.
 */
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

/**
 * Kuali STATED a refusal for the save — a transport failure, a GraphQL `errors`
 * array, a `status` other than `Ok`, or non-null `validations`.
 *
 * The click has already happened when this is thrown, so it is post-fence: the
 * task turns it into `save-refused` and the kernel parks. It exists as a type
 * for the same reason chunk 4's `UcpathCommitRefusedError` does — a
 * `UiActionProof` carries `performed: z.literal(true)`, so a `!performed`
 * branch is a union member with no producer, which is exactly the dead arm the
 * chunk-4 audit caught.
 */
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
