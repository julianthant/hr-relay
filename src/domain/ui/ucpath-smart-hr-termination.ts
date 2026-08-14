/**
 * The UCPath **Smart HR termination** surface — chunk 4's write family.
 *
 * Three wizard pages plus one search page, all live-observed on production
 * `ucphrprdpub.universityofcalifornia.edu` on **2026-08-13** and recorded in
 * `docs/migrations/separations.md` §9.7.
 *
 * ## The persistence crux, which is the whole shape of this family
 *
 * There is **zero durable footprint** anywhere in the wizard before an explicit
 * Save click. The live check filled Page A, created the transaction, filled
 * Page B, continued, staged Page C in full — and the *Transactions in Progress*
 * grid was byte-identical at every stage (baseline 5 rows), with `Transaction
 * ID` reading the literal `"NEW"` throughout. Abandoning by navigation left
 * nothing behind.
 *
 * So `prepare` stages **all three pages** and the **commit is the
 * `Save and Submit` click alone**. Everything before the doc 09 beat-⑤ fence is
 * provably reversible by navigating away; everything after it is not.
 *
 * ## Two things legacy does NOT have, and both matter
 *
 *  - **No name read anywhere in the termination flow.** Legacy fills the Empl
 *    ID on Page B and never reads back who UCPath resolved it to (checked
 *    against the pinned commit: `PERSON_NAME_NAME_DISPLAY` appears only in the
 *    Person Profile and PayPath families). That absence is the structural cause
 *    of the `T002173685` wrong-person termination. `#PERSON_NAME_NAME_DISPLAY`
 *    on Page B is therefore a control this repository verified and legacy never
 *    had — see `UCPATH_SMART_HR_DISPLAYED_PERSON_NAME` below for why it is
 *    driver-internal rather than published.
 *  - **One legacy key, two different elements.** Legacy fills Page B's Empl ID
 *    with `ssSmartHRTransactions.emplIdInput()` — the SS Smart HR *search
 *    form's* key. Live, those are two different controls:
 *    `#HR_TBH_WRK_EMPLID_PROMPT2` on the wizard and `#UC_SS_TBH_DVW_EMPLID` on
 *    the search form. The registry binds that key per CONTEXT rather than
 *    picking one and calling the other a fallback.
 *
 * ## Zero iframes
 *
 * Every page in this family renders with **no iframe at all**, so legacy's
 * `getContentFrame(page)` funnel resolves to nothing and every scope here is
 * `page`. That matches the 2026-08-04 finding for the SS Smart HR receipt page
 * and is the second surface in this store where it holds.
 */
import { z } from "zod";
import {
  EidSchema,
  ElementIdSchema,
  IsoInstantSchema,
  ObservationIdSchema,
} from "../ids.js";
import type { Eid, ElementId } from "../ids.js";
import { UcpathTerminationTemplateSchema } from "../separations/termination-type.js";
import type { MutationCapability, UiActionProof } from "./driver.js";
import { UcpathApprovalStatusSchema, UcpathTransactionReceiptSchema } from "./ucpath-ss-smart-hr.js";

/* ── Screens ─────────────────────────────────────────────────────────────── */

export const UcpathSmartHrSetupScreenSchema = z
  .literal("ucpath.smart-hr.setup").brand<"ScreenId">();
export const UcpathSmartHrDetailsScreenSchema = z
  .literal("ucpath.smart-hr.details").brand<"ScreenId">();
export const UcpathSmartHrInformationScreenSchema = z
  .literal("ucpath.smart-hr.information").brand<"ScreenId">();
export const UcpathSsSmartHrSearchScreenSchema = z
  .literal("ucpath.ss-smart-hr.search").brand<"ScreenId">();

export const UCPATH_SMART_HR_SETUP_SCREEN =
  UcpathSmartHrSetupScreenSchema.parse("ucpath.smart-hr.setup");
export const UCPATH_SMART_HR_DETAILS_SCREEN =
  UcpathSmartHrDetailsScreenSchema.parse("ucpath.smart-hr.details");
export const UCPATH_SMART_HR_INFORMATION_SCREEN =
  UcpathSmartHrInformationScreenSchema.parse("ucpath.smart-hr.information");
export const UCPATH_SS_SMART_HR_SEARCH_SCREEN =
  UcpathSsSmartHrSearchScreenSchema.parse("ucpath.ss-smart-hr.search");

/* ── Page states ─────────────────────────────────────────────────────────── */

export const UCPATH_SMART_HR_SETUP_READY =
  z.literal("ucpath.smart-hr.setup-ready").brand<"PageStateId">().parse("ucpath.smart-hr.setup-ready");
export const UCPATH_SMART_HR_DETAILS_READY =
  z.literal("ucpath.smart-hr.details-ready").brand<"PageStateId">().parse("ucpath.smart-hr.details-ready");
export const UCPATH_SMART_HR_INFORMATION_READY =
  z.literal("ucpath.smart-hr.information-ready").brand<"PageStateId">().parse("ucpath.smart-hr.information-ready");
/**
 * The staged page the doc 09 beat-⑤ fence binds to. It is reached only when
 * every field of all three pages has been staged AND read back, which is why
 * `prepare` returns it by name: the write sequencer refuses to fence a prepare
 * output that cannot name the exact page it staged.
 */
export const UCPATH_SMART_HR_TERMINATION_STAGED =
  z.literal("ucpath.smart-hr.termination-staged").brand<"PageStateId">().parse("ucpath.smart-hr.termination-staged");
export const UCPATH_SS_SMART_HR_SEARCH_READY =
  z.literal("ucpath.ss-smart-hr.search-ready").brand<"PageStateId">().parse("ucpath.ss-smart-hr.search-ready");

/* ── Elements ────────────────────────────────────────────────────────────── */

export const UCPATH_SMART_HR_TEMPLATE_INPUT = ElementIdSchema.parse("ucpath.smart-hr.template-input");
export const UCPATH_SMART_HR_TRANSACTION_DATE_INPUT =
  ElementIdSchema.parse("ucpath.smart-hr.transaction-date-input");
export const UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON =
  ElementIdSchema.parse("ucpath.smart-hr.create-transaction-button");
export const UCPATH_SMART_HR_DETAILS_EID_INPUT = ElementIdSchema.parse("ucpath.smart-hr.details-eid-input");
export const UCPATH_SMART_HR_REASON_CODE_SELECT = ElementIdSchema.parse("ucpath.smart-hr.reason-code-select");
export const UCPATH_SMART_HR_CONTINUE_BUTTON = ElementIdSchema.parse("ucpath.smart-hr.continue-button");
export const UCPATH_SMART_HR_OVERRIDE_LDW_CHECKBOX =
  ElementIdSchema.parse("ucpath.smart-hr.override-ldw-checkbox");
export const UCPATH_SMART_HR_LAST_DATE_WORKED_INPUT =
  ElementIdSchema.parse("ucpath.smart-hr.last-date-worked-input");
export const UCPATH_SMART_HR_INITIATOR_COMMENTS_FIELD =
  ElementIdSchema.parse("ucpath.smart-hr.initiator-comments-field");
export const UCPATH_SMART_HR_TRANSACTION_COMMENTS_FIELD =
  ElementIdSchema.parse("ucpath.smart-hr.transaction-comments-field");
export const UCPATH_SMART_HR_CONFIRMATION_OK_BUTTON =
  ElementIdSchema.parse("ucpath.smart-hr.confirmation-ok-button");
export const UCPATH_SMART_HR_ERROR_BANNER = ElementIdSchema.parse("ucpath.smart-hr.error-banner");
export const UCPATH_SMART_HR_DELETE_SELECTED_BUTTON =
  ElementIdSchema.parse("ucpath.smart-hr.delete-selected-button");
export const UCPATH_SS_SMART_HR_SEARCH_EID_INPUT =
  ElementIdSchema.parse("ucpath.ss-smart-hr.search-eid-input");
export const UCPATH_SS_SMART_HR_SEARCH_BUTTON = ElementIdSchema.parse("ucpath.ss-smart-hr.search-button");

/**
 * The ONE control that commits a termination, and the ONE control that commits
 * a pending sweep. Both are `commit`-effect elements: a driver may click them
 * only through `commit(id, capability)` with a capability the fenced write
 * sequencer minted.
 */
export const UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON =
  ElementIdSchema.parse("ucpath.smart-hr.save-and-submit-button");

/* ── Observations ────────────────────────────────────────────────────────── */

/**
 * Page B's rendering of **who UCPath resolved the typed Empl ID to** — the
 * beat-③ subject anchor for every write in this family.
 *
 * It is NOT published as a registry element/observation, and that is deliberate
 * rather than an omission: legacy has **no selector key for it on this screen**
 * (`PERSON_NAME_NAME_DISPLAY` appears only in the Person Profile and PayPath
 * groups), and publishing a registry row with no ported legacy row would be a
 * fabricated provenance — the exact thing the `semantic-ui-registry` guard
 * exists to prevent, and the rule `new-kronos` already applied to its grid.
 * It is therefore driver-internal, documented here, in the store's CLAUDE.md,
 * and in the migration doc's §9.7 mapping appendix.
 *
 * Two live facts decided this anchor over the alternatives. Page C's identity
 * block is unstyled `<span>`s inside `#myDIV` with no stable ids, so there is
 * nothing there to bind that is not positional. And reading the Empl ID field
 * back proves nothing at all — it is the run's own input echoed to itself,
 * whereas the name is UCPath's own answer to it.
 */
export const UCPATH_SMART_HR_DISPLAYED_PERSON_NAME =
  ObservationIdSchema.parse("ucpath.smart-hr.displayed-person-name");

/**
 * The SS Smart HR transaction DETAIL page's own rendering of whose transaction
 * this is (`#NAME$0`). It is the subject fact both probes check every scanned
 * row against, so an absence read off somebody else's transaction list can
 * never be reported as "this person has no termination".
 *
 * Same provenance status as the wizard's name: legacy scrapes this page for a
 * transaction number and a status and never reads the name, so there is no key
 * to port and it stays driver-internal (§9.7).
 */
export const UCPATH_SS_SMART_HR_DISPLAYED_NAME =
  ObservationIdSchema.parse("ucpath.ss-smart-hr.displayed-name");

/* ── Values ──────────────────────────────────────────────────────────────── */

/**
 * A UCPath Action Reason as this repository names it. It is deliberately a
 * plain non-empty string rather than an enum: the map in
 * `src/domain/separations/termination-type.ts` holds fifteen legacy-ported
 * DISPLAY texts and one live-captured option VALUE (`NSE`), so the driver
 * resolves it against the control's own options by value or label and refuses
 * unless exactly one matches. Narrowing the type here would force one of those
 * two provenances to be rewritten as a guess.
 */
export const UcpathActionReasonSchema = z.string().min(1).max(80);
export type UcpathActionReason = z.infer<typeof UcpathActionReasonSchema>;

/** PeopleSoft renders and accepts `MM/DD/YYYY` on every date field here. */
export const UcpathUsDateSchema = z.string().regex(
  /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/u,
  "a UCPath Smart HR date is MM/DD/YYYY",
);

/** What a run asks for. The permanent key is EID + effective date (doc 09 §5). */
export const UcpathTerminationTargetSchema = z.strictObject({
  emplId: EidSchema,
  /**
   * The name the operator approved at the ALWAYS-GATE, compared against Page
   * B's own rendering before anything is fenced. It is REQUIRED: a termination
   * whose subject binding is optional is a termination with no wrong-person
   * control, which is `T002173685`.
   */
  expectedName: z.string().min(1),
  emplRecord: z.string().min(1),
  effectiveDate: UcpathUsDateSchema,
  template: UcpathTerminationTemplateSchema,
  reasonCode: UcpathActionReasonSchema,
  lastDateWorked: UcpathUsDateSchema,
  initiatorComments: z.string().min(1),
});
export type UcpathTerminationTarget = z.infer<typeof UcpathTerminationTargetSchema>;

/** The date-agnostic sweep's target: a person, and nothing else (doc 09 §5). */
export const UcpathPendingSweepTargetSchema = z.strictObject({
  emplId: EidSchema,
  expectedName: z.string().min(1),
});
export type UcpathPendingSweepTarget = z.infer<typeof UcpathPendingSweepTargetSchema>;

/**
 * ONE transaction row as the SS Smart HR search surface renders it — the rich
 * read (D194). Nothing here is classified: `action` and `approvalStatus` are
 * verbatim, and the two probes fold them differently.
 */
export const UcpathTransactionRowSchema = z.strictObject({
  transactionId: UcpathTransactionReceiptSchema,
  emplId: EidSchema,
  /** As rendered, e.g. `Terminatn`. Verbatim — the fold owns the matching. */
  action: z.string().min(1),
  approvalStatus: UcpathApprovalStatusSchema,
  /** The transaction's effective/start date as the detail page rendered it. */
  startDate: UcpathUsDateSchema,
  /** The name the detail page showed for this transaction's subject. */
  displayedName: z.string().min(1),
});
export type UcpathTransactionRow = z.infer<typeof UcpathTransactionRowSchema>;

/**
 * The rich read of one person's Smart HR transactions.
 *
 * It is ONE page visit (D194) — the EID-filtered search plus a detail read per
 * row — and it classifies nothing, because the idempotency probe and the
 * pending sweep ask genuinely different questions of the same rows. A read that
 * cannot complete is `unreadable`, never an empty list: "the search failed" and
 * "this person has no transactions" are the two answers legacy collapsed, and
 * collapsing them is how a duplicate termination gets authorized (S45/S46).
 */
export const UcpathTransactionScanSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("read"),
    emplId: EidSchema,
    rows: z.array(UcpathTransactionRowSchema),
    /** Every row the grid rendered, before the per-row detail read. */
    scannedRowCount: z.number().int().min(0),
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("unreadable"),
    emplId: EidSchema,
    reason: z.string().min(1),
    observedAt: IsoInstantSchema,
  }),
]);
export type UcpathTransactionScan = z.infer<typeof UcpathTransactionScanSchema>;

/**
 * The typed proof a landed termination leaves behind: the transaction number
 * and its approval status, read back off the SS Smart HR detail page.
 *
 * The PAIR is the proof and the number alone is never one — a Denied
 * transaction carries a perfectly well-formed `T…` (live `T002204014`,
 * 2026-08-04), so legacy's `/^T\d{6,}$/` test stamps a refused write as a
 * successful receipt.
 */
export const UcpathTerminationProofSchema = z.strictObject({
  kind: z.literal("ucpath-termination"),
  emplId: EidSchema,
  effectiveDate: UcpathUsDateSchema,
  transactionId: UcpathTransactionReceiptSchema,
  approvalStatus: UcpathApprovalStatusSchema,
  displayedName: z.string().min(1),
  source: z.literal("ss-smart-hr-detail-read"),
});
export type UcpathTerminationProof = z.infer<typeof UcpathTerminationProofSchema>;

/**
 * The sweep's proof, stated as what a scan can actually establish: **at
 * `observedAt`, this person's transaction grid carried no in-progress
 * termination rows.**
 *
 * It deliberately does NOT list what was deleted. After the Delete click those
 * rows are gone, so a post-click read cannot name them, and a proof that quoted
 * the pre-click selection back would be reporting an intention as an
 * observation. What the run selected is recorded by `prepare` and lives in the
 * node's provenance; what the PROOF says is only what was seen.
 *
 * `scannedRowCount` is why this is evidence rather than an assertion: a grid
 * that rendered nothing at all and a grid with rows none of which are in
 * progress are different observations, and only the second one settles.
 */
export const UcpathPendingSweepProofSchema = z.strictObject({
  kind: z.literal("ucpath-pending-terminations-clear"),
  emplId: EidSchema,
  scannedRowCount: z.number().int().min(0),
  observedAt: IsoInstantSchema,
  source: z.literal("ss-smart-hr-detail-read"),
});
export type UcpathPendingSweepProof = z.infer<typeof UcpathPendingSweepProofSchema>;

/** What `prepare` proved it staged, page by page. */
export const UcpathTerminationStagingSchema = z.strictObject({
  stagedPageState: z.literal(UCPATH_SMART_HR_TERMINATION_STAGED),
  emplId: EidSchema,
  /** UCPath's OWN rendering of the person, Page B, read back after the blur. */
  observedName: z.string().min(1),
  observedEmplRecord: z.string().min(1),
  template: UcpathTerminationTemplateSchema,
  transactionDate: UcpathUsDateSchema,
  effectiveDate: UcpathUsDateSchema,
  /** The option the reason control resolved to, as the control renders it. */
  resolvedReasonOption: z.string().min(1),
  /** Every option the reason control carried — §3.2 MAP EVERYTHING. */
  observedReasonOptions: z.array(z.string().min(1)).min(1),
  lastDateWorked: UcpathUsDateSchema,
  /** S49: the override checkbox read back as CHECKED with the date agreeing. */
  lastDateWorkedOverridden: z.literal(true),
  /** `"NEW"` on every staged wizard — the crux's own evidence, read back. */
  transactionIdDisplay: z.literal("NEW"),
  observedAt: IsoInstantSchema,
});
export type UcpathTerminationStaging = z.infer<typeof UcpathTerminationStagingSchema>;

/**
 * One row of the *Transactions in Progress* grid, as that grid can actually
 * name it.
 *
 * It is NOT a transaction id, and that is a live finding rather than a
 * simplification: the in-progress grid's columns are
 * `Select · Transaction Type · Effective Date · Name · Person ID · Action ·
 * Country` (observed 2026-08-14) — there is no Transaction ID column at all,
 * because an in-progress transaction has not been assigned one yet. A
 * `selected` list of `T…` ids would therefore be a list this page cannot
 * produce, which is a schema describing something that does not exist.
 */
export const UcpathInProgressRowSchema = z.strictObject({
  transactionType: z.string().min(1),
  effectiveDate: UcpathUsDateSchema,
  action: z.string().min(1),
});
export type UcpathInProgressRow = z.infer<typeof UcpathInProgressRowSchema>;

/** What the sweep's `prepare` proved it selected, before any Delete click. */
export const UcpathPendingSweepStagingSchema = z.strictObject({
  stagedPageState: z.literal(UCPATH_SMART_HR_TERMINATION_STAGED),
  emplId: EidSchema,
  observedName: z.string().min(1),
  /** The in-progress rows this sweep ticked, by what the grid renders. */
  selected: z.array(UcpathInProgressRowSchema),
  observedAt: IsoInstantSchema,
});
export type UcpathPendingSweepStaging = z.infer<typeof UcpathPendingSweepStagingSchema>;

/* ── Driver surface ──────────────────────────────────────────────────────── */

export type UcpathSmartHrScreens =
  | typeof UCPATH_SMART_HR_SETUP_SCREEN
  | typeof UCPATH_SMART_HR_DETAILS_SCREEN
  | typeof UCPATH_SMART_HR_INFORMATION_SCREEN
  | typeof UCPATH_SS_SMART_HR_SEARCH_SCREEN;

export type UcpathSmartHrStates =
  | typeof UCPATH_SMART_HR_SETUP_READY
  | typeof UCPATH_SMART_HR_DETAILS_READY
  | typeof UCPATH_SMART_HR_INFORMATION_READY
  | typeof UCPATH_SMART_HR_TERMINATION_STAGED
  | typeof UCPATH_SS_SMART_HR_SEARCH_READY;

export type UcpathSmartHrObservations = Readonly<{
  [UCPATH_SMART_HR_DISPLAYED_PERSON_NAME]: string;
  [UCPATH_SS_SMART_HR_DISPLAYED_NAME]: string;
}>;

/**
 * The semantic operations chunk 4's tasks call. They are declared on the ONE
 * `ucpath` driver declaration the whole store binds (D197 rule 1): a sibling
 * task family extends the store's invariant declaration, it never mints a
 * second one.
 */
export type UcpathSmartHrTerminationDriver = Readonly<{
  /**
   * D194's rich read: every Smart HR transaction this person has, with each
   * row's action, status, start date and displayed name, read off the search
   * page plus one detail visit per row. Both probe kinds fold THIS.
   */
  scanTerminationTransactions(
    input: Readonly<{ emplId: Eid }>,
  ): Promise<UcpathTransactionScan>;
  /** Stages the whole three-page wizard. Nothing durable — see the crux. */
  stageTermination(input: UcpathTerminationTarget): Promise<UcpathTerminationStaging>;
  /** Ticks every in-progress termination row for this person. No click yet. */
  stagePendingTerminationSweep(
    input: UcpathPendingSweepTarget,
  ): Promise<UcpathPendingSweepStaging>;
  /**
   * The ONLY external write. `id` is one of the two commit elements and the
   * capability is unforgeable, so this cannot fire outside an open fence.
   */
  commit(id: ElementId, capability: MutationCapability): Promise<UiActionProof>;
}>;

/**
 * A termination action, in EITHER of the two vocabularies UCPath uses — and
 * there really are two, which a live read on 2026-08-13 is what settled.
 *
 * | Surface | Renders | Live evidence |
 * |---|---|---|
 * | SS Smart HR search grid and its transaction DETAIL | the PeopleSoft code `TER` | EID 10001799's four rows read `TER`, `TER`, `(blank)`, `HIR`; the detail for `T002209631` reads `TER` |
 * | Smart HR *Transactions in Progress* grid | the descriptive `Terminatn` | legacy's pending sweep matches `/Terminat/i` on that grid's row text |
 *
 * So this accepts the exact code `TER` **or** a `Terminat` prefix, and neither
 * arm is a fuzzy match: one is an equality test against a closed PeopleSoft
 * code, the other is a prefix test legacy already relies on. Accepting only the
 * prefix — which is what this function did before the live read — would have
 * made every SS Smart HR probe answer `absent` about a person who has a
 * termination, which is the duplicate-filing failure the probe exists to stop.
 *
 * A `(blank)` action (a real value the live grid rendered) matches neither, and
 * that is correct: an action nobody named is not a termination.
 */
export function isUcpathTerminationAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  return normalized === "ter" || normalized.startsWith("terminat");
}

/**
 * An in-progress termination is one the sweep may delete: `Pending` or
 * `Pushed Back`. `Approved`, `Denied`, `Error` and `Manually Processed` are
 * settled and are never swept — deleting a settled row would destroy a record
 * of something that already happened.
 */
export function isUcpathTerminationInProgress(row: UcpathTransactionRow): boolean {
  return isUcpathTerminationAction(row.action)
    && (row.approvalStatus === "Pending" || row.approvalStatus === "Pushed Back");
}
