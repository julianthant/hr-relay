import { z } from "zod";
import { EidSchema, ElementIdSchema, IsoInstantSchema, PageStateIdSchema } from "../../rules/identity/ids.js";
import { UcpathSsSmartHrSettlementDiagnosticSchema, UcpathTransactionRowSchema } from "./ucpath-smart-hr-termination.js";

export const UCPATH_SS_SMART_HR_FINDINGS_LIST_READY = PageStateIdSchema.parse("ucpath.ss-smart-hr.findings-list-ready");
export const UCPATH_SS_SMART_HR_FINDINGS_DETAIL_READY = PageStateIdSchema.parse("ucpath.ss-smart-hr.findings-detail-ready");
export const UCPATH_SS_SMART_HR_RESULT_TRANSACTION_ID = ElementIdSchema.parse("ucpath.ss-smart-hr.result-transaction-id");
export const UCPATH_SS_SMART_HR_RESULT_EID = ElementIdSchema.parse("ucpath.ss-smart-hr.result-eid");
export const UCPATH_SS_SMART_HR_RESULT_NAME = ElementIdSchema.parse("ucpath.ss-smart-hr.result-name");
export const UCPATH_SS_SMART_HR_RESULT_DRILL_IN = ElementIdSchema.parse("ucpath.ss-smart-hr.result-drill-in");
export const UCPATH_SS_SMART_HR_RESULT_COUNTER = ElementIdSchema.parse("ucpath.ss-smart-hr.result-counter");
export const UCPATH_SS_SMART_HR_RESULTS_VIEW_ALL = ElementIdSchema.parse("ucpath.ss-smart-hr.results-view-all");
export const UCPATH_SS_SMART_HR_DETAIL_REQUESTED = ElementIdSchema.parse("ucpath.ss-smart-hr.detail-requested");
export const UCPATH_SS_SMART_HR_DETAIL_NAME = ElementIdSchema.parse("ucpath.ss-smart-hr.detail-name");
export const UCPATH_SS_SMART_HR_DETAIL_ACTION = ElementIdSchema.parse("ucpath.ss-smart-hr.detail-action");
export const UCPATH_SS_SMART_HR_DETAIL_START_DATE = ElementIdSchema.parse("ucpath.ss-smart-hr.detail-start-date");
export const UCPATH_SS_SMART_HR_RETURN_TO_LIST = ElementIdSchema.parse("ucpath.ss-smart-hr.return-to-list");

// PeopleSoft supplies no timezone here; keep its actual Requested text, including microseconds.
export const UcpathSubmittedAtDisplaySchema = z.string().regex(
  /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{2} (0?[1-9]|1[0-2]):[0-5]\d:[0-5]\d\.\d{6}(?:AM|PM)$/u,
  "UCPath Requested is MM/DD/YY h:mm:ss.ffffffAM or PM",
);

export const UcpathTransactionFindingSchema = UcpathTransactionRowSchema.extend({
  submittedAt: UcpathSubmittedAtDisplaySchema,
  detailVerified: z.literal(true),
});
export type UcpathTransactionFinding = z.infer<typeof UcpathTransactionFindingSchema>;

export const UcpathTransactionFindingsReadSchema = z.strictObject({
  state: z.literal("read"),
  emplId: EidSchema,
  rows: z.array(UcpathTransactionFindingSchema).max(300),
  scannedRowCount: z.number().int().min(0).max(300),
  completeness: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("complete"), reportedRowCount: z.number().int().min(0).max(299) }),
    z.strictObject({ state: z.literal("incomplete"), reason: z.literal("search-cap"), reportedRowCount: z.literal(300) }),
  ]),
  observedAt: IsoInstantSchema,
  source: z.literal("ss-smart-hr-list-and-detail"),
}).superRefine((scan, ctx) => {
  if (scan.scannedRowCount !== scan.rows.length || scan.scannedRowCount !== scan.completeness.reportedRowCount) {
    ctx.addIssue({ code: "custom", message: "transaction findings must account for every reported result row" });
  }
  const ids = scan.rows.map(row => row.transactionId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "transaction findings require unique transaction IDs" });
  if (scan.rows.some(row => row.emplId !== scan.emplId)) ctx.addIssue({ code: "custom", message: "a finding belongs to another employee" });
});
export type UcpathTransactionFindingsRead = z.infer<typeof UcpathTransactionFindingsReadSchema>;

export const UcpathTransactionFindingsSchema = z.discriminatedUnion("state", [
  UcpathTransactionFindingsReadSchema,
  z.strictObject({
    state: z.literal("unreadable"),
    emplId: EidSchema,
    reason: z.string().min(1),
    diagnostic: UcpathSsSmartHrSettlementDiagnosticSchema,
    observedAt: IsoInstantSchema,
  }),
]);
export type UcpathTransactionFindings = z.infer<typeof UcpathTransactionFindingsSchema>;
