import { z } from "zod";

/** The SS Smart HR transaction-detail semantic ids — UCPath's `receipt` completion-proof surface; a submit mints a `T…`, and this surface reads it back. */
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

/** `T` + at least six digits — PeopleSoft's Smart HR transaction number. */
export const UcpathTransactionReceiptSchema = z.string().regex(
  /^T\d{6,}$/u,
  "a UCPath transaction receipt is `T` followed by at least six digits",
);
export type UcpathTransactionReceipt = z.infer<typeof UcpathTransactionReceiptSchema>;

/** The closed approval-status vocabulary, read live from the search filter's own option list; `Approved` is the only value that means the transaction took effect. */
export const UcpathApprovalStatusSchema = z.enum([
  "Approved",
  "Denied",
  "Error",
  "Manually Processed",
  "Pending",
  "Pushed Back",
]);
export type UcpathApprovalStatus = z.infer<typeof UcpathApprovalStatusSchema>;
