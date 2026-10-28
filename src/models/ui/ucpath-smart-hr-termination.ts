/** The UCPath **Smart HR termination** surface — three wizard pages plus one search page, all live-observed on production and recorded here. */
import { z } from "zod";
import {
  EidSchema,
  ElementIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ObservationIdSchema,
} from "../../rules/identity/ids.js";
import type { Eid, ElementId } from "../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../rules/redaction/redaction.js";
import { UcpathTerminationTemplateSchema } from "../../rules/separations/termination-type.js";
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
/** Prepare names the page only after all three pages' fields are staged and read back. */
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

/** The ONE control that commits a termination, and the ONE control that commits a pending sweep; both are clickable only through `commit(id, capability)` with a minted capability. */
export const UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON =
  ElementIdSchema.parse("ucpath.smart-hr.save-and-submit-button");

/* ── Observations ────────────────────────────────────────────────────────── */

/** Page B's rendering of **who UCPath resolved the typed Empl ID to** — the subject anchor for every write in this family. */
export const UCPATH_SMART_HR_DISPLAYED_PERSON_NAME =
  ObservationIdSchema.parse("ucpath.smart-hr.displayed-person-name");

/** The SS Smart HR transaction DETAIL page's own rendering of whose transaction this is; it is the subject fact both probes check every scanned row against. */
export const UCPATH_SS_SMART_HR_DISPLAYED_NAME =
  ObservationIdSchema.parse("ucpath.ss-smart-hr.displayed-name");

/** The *Transactions in Progress* grid's own rendering of whose row this is — the SWEEP's subject anchor, a separate observation because the sweep stages a DIFFERENT page. */
export const UCPATH_SMART_HR_IN_PROGRESS_NAME =
  ObservationIdSchema.parse("ucpath.smart-hr.in-progress-displayed-name");

/* ── Values ──────────────────────────────────────────────────────────────── */

/** A UCPath Action Reason as this repository names it; deliberately a plain non-empty string, so the driver resolves it against the control's own options and refuses unless exactly one matches. */
export const UcpathActionReasonSchema = z.string().min(1).max(80);
export type UcpathActionReason = z.infer<typeof UcpathActionReasonSchema>;

/** PeopleSoft renders and accepts `MM/DD/YYYY` on every date field here. */
export const UcpathUsDateSchema = z.string().regex(
  /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/u,
  "a UCPath Smart HR date is MM/DD/YYYY",
);

/** What a run asks for. The permanent key is EID + effective date (ref write-safety ). */
export const UcpathTerminationTargetSchema = z.strictObject({
  emplId: EidSchema,
    /* Require the verified/approved name to match Page B before fencing any write. */
  expectedName: z.string().min(1),
  emplRecord: z.string().min(1),
  effectiveDate: UcpathUsDateSchema,
  template: UcpathTerminationTemplateSchema,
  reasonCode: UcpathActionReasonSchema,
  lastDateWorked: UcpathUsDateSchema,
  initiatorComments: z.string().min(1),
});
export type UcpathTerminationTarget = z.infer<typeof UcpathTerminationTargetSchema>;

/** ONE transaction row as the SS Smart HR search surface renders it — the rich read; nothing here is classified: `action` and `approvalStatus` are verbatim. */
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

/** The exact transaction set the SS Smart HR search/detail surface observed before a pending sweep was admitted, ordered by the stable `T…` transaction id. */
export const UcpathPendingTransactionSetSchema = z.strictObject({
  kind: z.literal("ucpath-pending-termination-set"),
  emplId: EidSchema,
  eligible: z.array(UcpathTransactionRowSchema),
  protected: z.array(UcpathTransactionRowSchema),
  observedAt: IsoInstantSchema,
  source: z.literal("ss-smart-hr-detail-read"),
}).superRefine((set, ctx) => {
  const rows = [...set.eligible, ...set.protected];
  const ids = rows.map((row) => row.transactionId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "a pending transaction set requires unique transaction ids" });
  }
  for (const [partition, partitionRows] of [
    ["eligible", set.eligible],
    ["protected", set.protected],
  ] as const) {
    const sorted = [...partitionRows].sort((left, right) =>
      left.transactionId.localeCompare(right.transactionId));
    if (partitionRows.some((row, index) => row.transactionId !== sorted[index]?.transactionId)) {
      ctx.addIssue({ code: "custom", message: `${partition} transaction rows must be ordered by transaction id` });
    }
    for (const row of partitionRows) {
      if (row.emplId !== set.emplId) {
        ctx.addIssue({ code: "custom", message: `${partition} transaction ${row.transactionId} belongs to another EID` });
      }
      const inProgress = isUcpathTerminationInProgress(row);
      if ((partition === "eligible") !== inProgress) {
        ctx.addIssue({ code: "custom", message: `${partition} transaction ${row.transactionId} is in the wrong partition` });
      }
    }
  }
});
export type UcpathPendingTransactionSet = z.infer<typeof UcpathPendingTransactionSetSchema>;

/** A pending sweep is authorized for one machine-observed exact transaction set; it is not a caller switch or an additional human approval gate. */
export const UcpathPendingSweepTargetSchema = z.strictObject({
  emplId: EidSchema,
  expectedName: z.string().min(1),
  observedSet: UcpathPendingTransactionSetSchema,
}).superRefine((target, ctx) => {
  if (target.observedSet.emplId !== target.emplId) {
    ctx.addIssue({ code: "custom", message: "the pending transaction set belongs to another EID" });
  }
});
export type UcpathPendingSweepTarget = z.infer<typeof UcpathPendingSweepTargetSchema>;

/** Redacted facts captured only when the settlement race cannot decide rows versus no-match; the captured arm is deliberately closed over categories, counts, and booleans. */
export const UcpathSsSmartHrSettlementDiagnosticSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("captured"),
    banner: z.enum(["absent", "no-match", "positive-count", "other"]),
    oldRowCount: z.number().int().min(0),
    route: z.enum(["ss-smart-hr-search", "other"]),
    iframeCount: z.number().int().min(0),
    errorRegionCount: z.number().int().min(0),
    searchVisible: z.boolean(),
    searchEnabled: z.boolean(),
  }),
  z.strictObject({
    state: z.literal("not-attempted"),
    cause: z.literal("not-indeterminate-settlement"),
  }),
  z.strictObject({
    state: z.literal("capture-failed"),
    cause: z.literal("page-evaluation-failed"),
  }),
]);
export type UcpathSsSmartHrSettlementDiagnostic = z.infer<
  typeof UcpathSsSmartHrSettlementDiagnosticSchema
>;

/** The rich read of one person's Smart HR transactions: ONE page visit, and it classifies nothing, because the idempotency probe and the pending sweep ask different questions of the same rows. */
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
    diagnostic: UcpathSsSmartHrSettlementDiagnosticSchema,
    observedAt: IsoInstantSchema,
  }),
]);
export type UcpathTransactionScan = z.infer<typeof UcpathTransactionScanSchema>;

/** Transaction number and accepted status together prove settlement; number alone does not. */
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

/** A fresh SS Smart HR detail read proving that the exact filing named by the durable receipt still exists before Kuali may record it; a finalization precondition, not a new filing receipt. */
export const UcpathTerminationFilingPresenceProofSchema = z.strictObject({
  kind: z.literal("ucpath-termination-filing-presence"),
  transactionId: UcpathTransactionReceiptSchema,
  emplId: EidSchema,
  effectiveDate: UcpathUsDateSchema,
  approvalStatus: UcpathApprovalStatusSchema,
  displayedName: z.string().min(1),
  observedAt: IsoInstantSchema,
  source: z.literal("ss-smart-hr-detail-read"),
  receiptDisposition: z.enum(["committed", "already-present", "operator-asserted"]),
  authority: z.literal("kuali-finalization-precondition"),
});
export type UcpathTerminationFilingPresenceProof = z.infer<
  typeof UcpathTerminationFilingPresenceProofSchema
>;

/** Settlement records retain the final grid observation and the exact selected set. */
const UcpathPendingSweepObservationFields = {
  kind: z.literal("ucpath-pending-terminations-clear"),
  emplId: EidSchema,
  scannedRowCount: z.number().int().min(0),
  observedAt: IsoInstantSchema,
  source: z.literal("ss-smart-hr-detail-read"),
} as const;

/** A canonical, recoverable list of stable transaction ids, carried as one comma-separated scalar with `none` as the exact empty-list spelling; the producer preserves the canonical ordering. */
export const UcpathPendingTransactionIdListSchema = z.string().regex(
  /^(?:none|T\d{6,}(?:,T\d{6,})*)$/u,
  "a pending transaction id list is `none` or canonical comma-separated T ids",
);

export function ucpathPendingTransactionIdList(
  rows: readonly UcpathTransactionRow[],
): string {
  return UcpathPendingTransactionIdListSchema.parse(
    rows.length === 0 ? "none" : rows.map((row) => row.transactionId).join(","),
  );
}

/** Selected and protected stable IDs are bound to the row-fact digest that keyed the intent. */
export const UcpathPendingSweepSettlementProofSchema = z.strictObject({
  ...UcpathPendingSweepObservationFields,
  version: z.literal(2),
  selectedTransactionIds: UcpathPendingTransactionIdListSchema,
  protectedTransactionIds: UcpathPendingTransactionIdListSchema,
  setDigest: FingerprintSchema,
});
export type UcpathPendingSweepSettlementProof = z.infer<
  typeof UcpathPendingSweepSettlementProofSchema
>;


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
  /** Read back the override checkbox and matching date. */
  lastDateWorkedOverridden: z.literal(true),
  /** `"NEW"` on every staged wizard — the crux's own evidence, read back. */
  transactionIdDisplay: z.literal("NEW"),
  observedAt: IsoInstantSchema,
});
export type UcpathTerminationStaging = z.infer<typeof UcpathTerminationStagingSchema>;

/** Join stable IDs from EID-filtered details only after a complete unique grid match. */
export const UcpathInProgressRowSchema = z.strictObject({
  transactionType: z.string().min(1),
  effectiveDate: UcpathUsDateSchema,
  displayedName: z.string().min(1),
  emplId: EidSchema,
  action: z.string().min(1),
  country: z.string().min(1),
  /** The stable SS Smart HR transaction id joined by exact row facts. */
  transactionId: UcpathTransactionReceiptSchema,
});
export type UcpathInProgressRow = z.infer<typeof UcpathInProgressRowSchema>;

/** What the sweep's `prepare` proved it selected, before any Delete click. */
export const UcpathPendingSweepStagingSchema = z.strictObject({
  stagedPageState: z.literal(UCPATH_SMART_HR_TERMINATION_STAGED),
  emplId: EidSchema,
  observedName: z.string().min(1),
  /** The in-progress rows this sweep ticked, each joined to its stable T id. */
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
  [UCPATH_SMART_HR_IN_PROGRESS_NAME]: string;
}>;

/** The semantic operations the store's tasks call, declared on the ONE `ucpath` driver declaration the whole store binds; a sibling family extends it, never mints a second. */
export type UcpathSmartHrTerminationDriver = Readonly<{
    /* The rich read: every transaction this person has, with each row's action, status, start date and displayed name; both probe kinds fold THIS. */
  scanTerminationTransactions(
    input: Readonly<{ emplId: Eid; transactionId?: string }>,
  ): Promise<UcpathTransactionScan>;
  /** Stages the whole three-page wizard. Nothing durable — see the crux. */
  stageTermination(input: UcpathTerminationTarget): Promise<UcpathTerminationStaging>;
  /** Ticks every in-progress termination row for this person. No click yet. */
  stagePendingTerminationSweep(
    input: UcpathPendingSweepTarget,
  ): Promise<UcpathPendingSweepStaging>;
    /* The ONLY external write; `id` is one of the two commit elements and the capability is unforgeable, so this cannot fire outside an open fence. */
  commit(id: ElementId, capability: MutationCapability): Promise<UiActionProof>;
}>;

/* ── Typed driver refusals ───────────────────────────────────────────────── */

export class UcpathEmploymentRecordMismatchError extends Error {
  constructor(approvedRecord: string, observedRecord: string) {
    super(`UCPath displayed employment record ${JSON.stringify(observedRecord)}, not the approved `
      + `${JSON.stringify(approvedRecord)}. A blank or different employment record refuses termination staging.`);
    this.name = "UcpathEmploymentRecordMismatchError";
  }
}

/** Convert rejected Empl ID into a typed refusal before any staging page exists. */
export class UcpathEmplIdNotRecognizedError extends Error {
  readonly emplId: string;

  constructor(input: Readonly<{ emplId: string; detail: string; cause?: unknown }>) {
    super(
      `UCPath did not resolve Empl ID ${directIdentifierDisplay(input.emplId)} on the Smart HR transaction details page: `
      + `${input.detail}. No person name was rendered, so there is no subject to bind — either the `
      + "Empl ID does not exist or the employee has no employment record eligible for termination.",
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "UcpathEmplIdNotRecognizedError";
    this.emplId = input.emplId;
  }
}

/** The refusal after the commit click, which cannot travel back as an action proof — the schema working, because a proof is always a proof and the codes below are its own durable values. */
export class UcpathCommitRefusedError extends Error {
  readonly elementId: ElementId;
  readonly refusal: string;

  constructor(input: Readonly<{ elementId: ElementId; refusal: string }>) {
    super(
      `UCPath refused the commit through ${String(input.elementId)} and rendered: `
      + `${JSON.stringify(input.refusal)}`,
    );
    this.name = "UcpathCommitRefusedError";
    this.elementId = input.elementId;
    this.refusal = input.refusal;
  }
}

/** A termination action, in EITHER of the two vocabularies UCPath uses: the PeopleSoft code `TER` on the search/detail surfaces, and the descriptive `Terminat` prefix on the in-progress grid. */
export function isUcpathTerminationAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  return normalized === "ter" || normalized.startsWith("terminat");
}

/** Sweep only Pending/Pushed Back; settled rows preserve completed-operation evidence. */
export function isUcpathTerminationInProgress(row: UcpathTransactionRow): boolean {
  return isUcpathTerminationAction(row.action)
    && (row.approvalStatus === "Pending" || row.approvalStatus === "Pushed Back");
}
