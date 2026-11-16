import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { UcpathTransactionFindingsReadSchema } from "../../../src/models/ui/ucpath-transaction-findings.js";

const EID = EidSchema.parse("10800000");
const ROW = {
  transactionId: "T900001", emplId: EID, displayedName: "Synthetic, Findings",
  action: "Terminatn", approvalStatus: "Pending", startDate: "11/02/2026",
  submittedAt: "11/01/26 2:03:04.123456PM", detailVerified: true,
} as const;
const READ = {
  state: "read", emplId: EID, rows: [ROW], scannedRowCount: 1,
  completeness: { state: "complete", reportedRowCount: 1 },
  observedAt: "2026-11-02T18:00:00.000Z", source: "ss-smart-hr-list-and-detail",
} as const;

describe("UCPath transaction findings contract", () => {
  it("keeps Requested as local displayed text distinct from the observation instant", () => {
    const read = UcpathTransactionFindingsReadSchema.parse(READ);
    assert.equal(read.rows[0].submittedAt, "11/01/26 2:03:04.123456PM");
    assert.notEqual(read.rows[0].submittedAt, read.observedAt);
    assert.equal(UcpathTransactionFindingsReadSchema.safeParse({ ...READ,
      rows: [{ ...ROW, submittedAt: READ.observedAt }] }).success, false);
  });

  it("never admits an unverified detail, foreign employee or duplicated transaction", () => {
    for (const rows of [
      [{ ...ROW, detailVerified: false }],
      [{ ...ROW, emplId: "10800001" }],
      [ROW, ROW],
    ]) assert.equal(UcpathTransactionFindingsReadSchema.safeParse({ ...READ, rows,
      scannedRowCount: rows.length, completeness: { state: "complete", reportedRowCount: rows.length } }).success, false);
  });

  it("requires every reported row and refuses contradictory accounting", () => {
    assert.equal(UcpathTransactionFindingsReadSchema.safeParse({ ...READ, scannedRowCount: 0 }).success, false);
    assert.equal(UcpathTransactionFindingsReadSchema.safeParse({ ...READ,
      completeness: { state: "complete", reportedRowCount: 2 } }).success, false);
    assert.equal(UcpathTransactionFindingsReadSchema.safeParse({ ...READ,
      completeness: { state: "incomplete", reason: "search-cap", reportedRowCount: 1 } }).success, false);
  });

  it("retains all 300 capped findings without claiming completeness", () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ ...ROW, transactionId: `T${String(900000 + index)}` }));
    const capped = { ...READ, rows, scannedRowCount: 300,
      completeness: { state: "incomplete", reason: "search-cap", reportedRowCount: 300 } };
    const read = UcpathTransactionFindingsReadSchema.parse(capped);
    assert.equal(read.rows.length, 300);
    assert.equal(read.completeness.state, "incomplete");
    assert.equal(UcpathTransactionFindingsReadSchema.safeParse({ ...capped,
      completeness: { state: "complete", reportedRowCount: 300 } }).success, false);
  });

  it("rejects missing precision, invented zones and invalid clock fields", () => {
    for (const submittedAt of ["11/01/26 2:03:04PM", "11/01/26 13:03:04.123456PM", "11/01/26 2:60:04.123456PM",
      "11/01/26 2:03:04.123456PM PST", "11/01/2026 2:03:04.123456PM"]) {
      assert.equal(UcpathTransactionFindingsReadSchema.safeParse({ ...READ, rows: [{ ...ROW, submittedAt }] }).success, false);
    }
  });
});
