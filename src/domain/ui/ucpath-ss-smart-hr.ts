import { z } from "zod";

/**
 * The SS Smart HR transaction-detail semantic ids — UCPath's `receipt`
 * completion-proof surface (doc 09 §13 OQ2, settled by the 2026-08-04
 * read-only live probe).
 *
 * A UCPath Smart HR submit mints a `T…` transaction number. That number is
 * NOT rendered by the submit itself, and it is NOT carried by the Smart HR
 * Transaction Status dashboard (whose grid has no Transaction ID column at
 * all). The one page that displays it as an addressable field is
 * `UC_EXTENSIONS.UC_SS_TBH.GBL`'s transaction detail.
 *
 * Only two facts are registered, because only two are the proof: the receipt
 * number and the approval status. **Neither is sufficient alone.** A Denied
 * transaction carries a fully-formed `T…` (live: `T002204014`, REH, Denied —
 * one of 300 Denied rows visible on 2026-08-04), so a number on its own says
 * "a submit happened", never "the submit succeeded". The completion proof is
 * the PAIR.
 */
export const UcpathSsSmartHrTransactionScreenSchema = z
  .literal("ucpath.ss-smart-hr.transaction").brand<"ScreenId">();
export const UcpathSsSmartHrTransactionReadyStateSchema = z
  .literal("ucpath.ss-smart-hr.transaction-ready").brand<"PageStateId">();
export const UcpathSsSmartHrReceiptDisplaySchema = z
  .literal("ucpath.ss-smart-hr.receipt-display").brand<"ElementId">();
export const UcpathSsSmartHrApprovalStatusDisplaySchema = z
  .literal("ucpath.ss-smart-hr.approval-status-display").brand<"ElementId">();
export const UcpathSsSmartHrTransactionReceiptSchema = z
  .literal("ucpath.ss-smart-hr.transaction-receipt").brand<"ObservationId">();
export const UcpathSsSmartHrApprovalStatusSchema = z
  .literal("ucpath.ss-smart-hr.approval-status").brand<"ObservationId">();

export const UCPATH_SS_SMART_HR_TRANSACTION_SCREEN =
  UcpathSsSmartHrTransactionScreenSchema.parse("ucpath.ss-smart-hr.transaction");
export const UCPATH_SS_SMART_HR_TRANSACTION_READY =
  UcpathSsSmartHrTransactionReadyStateSchema.parse("ucpath.ss-smart-hr.transaction-ready");
export const UCPATH_SS_SMART_HR_RECEIPT_DISPLAY =
  UcpathSsSmartHrReceiptDisplaySchema.parse("ucpath.ss-smart-hr.receipt-display");
export const UCPATH_SS_SMART_HR_APPROVAL_STATUS_DISPLAY =
  UcpathSsSmartHrApprovalStatusDisplaySchema.parse("ucpath.ss-smart-hr.approval-status-display");
export const UCPATH_SS_SMART_HR_TRANSACTION_RECEIPT =
  UcpathSsSmartHrTransactionReceiptSchema.parse("ucpath.ss-smart-hr.transaction-receipt");
export const UCPATH_SS_SMART_HR_APPROVAL_STATUS =
  UcpathSsSmartHrApprovalStatusSchema.parse("ucpath.ss-smart-hr.approval-status");

/**
 * The reload-safe keyed deep link to one transaction's detail page.
 *
 * The BARE component URL is not a deep link: it renders the Find-an-Existing-Value
 * search form, and a reload of a search-drilled detail page silently returns to
 * that form while `location.href` stays byte-identical — so the URL is never
 * evidence of which state the page is in. Adding PeopleSoft's search key
 * (`Action=U&UC_TRANSACT_ID=…`) makes the detail addressable AND reload-stable
 * (live 2026-08-04: `T002204014` re-rendered byte-identically across a reload).
 *
 * **An unknown transaction id is the dangerous case.** UCPath does not error —
 * it silently renders the ordinary search form with no marker of any kind. The
 * caller must therefore prove the receipt field resolved AND that it equals the
 * requested id; a missing field is a loud failure, never "no receipt".
 */
export const UCPATH_SS_SMART_HR_TRANSACTION_URL =
  "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS"
  + "/c/UC_EXTENSIONS.UC_SS_TBH.GBL";

/** `T` + at least six digits — PeopleSoft's Smart HR transaction number. */
export const UcpathTransactionReceiptSchema = z.string().regex(
  /^T\d{6,}$/u,
  "a UCPath transaction receipt is `T` followed by at least six digits",
);
export type UcpathTransactionReceipt = z.infer<typeof UcpathTransactionReceiptSchema>;

/**
 * The closed approval-status vocabulary, read live from the SS Smart HR
 * search filter's own option list on 2026-08-04. `Approved` is the only
 * value that means the transaction took effect; `Pending` is in flight, and
 * `Denied` / `Error` / `Pushed Back` are failures that still carry a receipt.
 * `Manually Processed` is an out-of-band completion.
 */
export const UcpathApprovalStatusSchema = z.enum([
  "Approved",
  "Denied",
  "Error",
  "Manually Processed",
  "Pending",
  "Pushed Back",
]);
export type UcpathApprovalStatus = z.infer<typeof UcpathApprovalStatusSchema>;

/**
 * The only status that proves the external write landed. Everything else is
 * either in flight or refused — and both of those still expose a `T…`, which
 * is exactly why "we read a transaction number" may never stand in for
 * "the transaction succeeded".
 */
export function isUcpathTransactionSettledSuccessfully(status: UcpathApprovalStatus): boolean {
  return status === "Approved";
}
