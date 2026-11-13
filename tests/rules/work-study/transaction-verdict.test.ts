import { expect, it } from "vitest";
import { workStudyTransactionVerdict } from "../../../src/rules/work-study/transaction-verdict.js";
import { UcpathPayPathWorkStudyTargetSchema } from "../../../src/models/ui/ucpath-paypath.js";
import { UcpathTransactionFindingsSchema, type UcpathTransactionFindings } from "../../../src/models/ui/ucpath-transaction-findings.js";

const target = UcpathPayPathWorkStudyTargetSchema.parse({
  emplId: "10000001", expectedName: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F",
  comments: "Updated pool id to F per work study award 08/03/2026",
});
const row = (overrides: Readonly<Record<string, string>> = {}) => ({
  transactionId: "T002209631", emplId: "10000001", action: "Data Chg", approvalStatus: "Pending", startDate: "08/03/2026",
  displayedName: "Lee, Jordan", submittedAt: "08/03/26 10:15:00.000000AM", detailVerified: true, ...overrides,
});
const findings = (rows: readonly ReturnType<typeof row>[]): UcpathTransactionFindings => UcpathTransactionFindingsSchema.parse({
  state: "read", emplId: "10000001", rows, scannedRowCount: rows.length, completeness: { state: "complete", reportedRowCount: rows.length },
  observedAt: "2026-08-03T18:00:00.000Z", source: "ss-smart-hr-list-and-detail",
});

it("proves the filed transaction from the one work-study row on the effective date", () => {
  expect(workStudyTransactionVerdict(target, findings([row(), row({ transactionId: "T002209000", startDate: "07/01/2026" })]))).toEqual({
    state: "present", proof: {
      kind: "ucpath-paypath-work-study", emplId: "10000001", effectiveDate: "08/03/2026", transactionId: "T002209631",
      action: "Data Chg", approvalStatus: "Pending", displayedName: "Lee, Jordan", source: "ss-smart-hr-detail-read",
    },
  });
});

it("is absent, bound to the business key, only when no transaction of any kind carries the effective date", () => {
  const verdict = workStudyTransactionVerdict(target, findings([row({ startDate: "07/01/2026" }), row({ transactionId: "T002209632", action: "Terminatn", startDate: "06/30/2026" })]));
  expect(verdict.state).toBe("absent");
  const other = workStudyTransactionVerdict({ ...target, effectiveDate: "09/01/2026" }, findings([]));
  expect(verdict.state === "absent" && other.state === "absent" && verdict.evidence.idempotencyKeyDigest !== other.evidence.idempotencyKeyDigest).toBe(true);
  expect(verdict.state === "absent" && other.state === "absent" && verdict.evidence.queryDigest !== other.evidence.queryDigest).toBe(true);
});

it.each([
  ["a transaction of another kind", [row({ action: "Terminatn" })]],
  ["a work-study row beside another transaction", [row(), row({ transactionId: "T002209632", action: "Hire" })]],
])("is unknown, never absent or filed, when the effective date shows %s", (_name, rows) => {
  expect(workStudyTransactionVerdict(target, findings(rows)).state).toBe("unknown");
});

it("is ambiguous when two work-study rows carry the effective date", () => {
  const verdict = workStudyTransactionVerdict(target, findings([row(), row({ transactionId: "T002209632" })]));
  expect(verdict.state === "ambiguous" && verdict.matches).toBe(2);
});

it.each(["Denied", "Error", "Pushed Back"])("leaves a %s work-study row on the effective date unknown rather than absent or filed", status => {
  expect(workStudyTransactionVerdict(target, findings([row({ approvalStatus: status })])).state).toBe("unknown");
});

it("is unknown when the transaction search is unreadable or capped", () => {
  const unreadable = UcpathTransactionFindingsSchema.parse({ state: "unreadable", emplId: "10000001", reason: "grid did not settle",
    diagnostic: { state: "not-attempted", cause: "not-indeterminate-settlement" }, observedAt: "2026-08-03T18:00:00.000Z" });
  expect(workStudyTransactionVerdict(target, unreadable).state).toBe("unknown");
  const rows = Array.from({ length: 300 }, (_, index) => row({ transactionId: `T${String(1_000_000 + index)}`, startDate: "07/01/2026" }));
  const capped = UcpathTransactionFindingsSchema.parse({ state: "read", emplId: "10000001", rows, scannedRowCount: 300,
    completeness: { state: "incomplete", reason: "search-cap", reportedRowCount: 300 }, observedAt: "2026-08-03T18:00:00.000Z", source: "ss-smart-hr-list-and-detail" });
  expect(workStudyTransactionVerdict(target, capped).state).toBe("unknown");
});
