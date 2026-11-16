import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { UcpathFindingsDetailSchema } from "../../../src/models/dashboard/ucpath-findings.js";
import { UcpathReadTransactionFindings } from "../../../src/models/systems/ucpath/read-transaction-findings.js";
import { ParkedWriteDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { FIXTURE_PARKED_WRITE } from "../../support/fixtures/dashboard/run-detail/gates-park.js";

const row = { transactionId: "T123456", emplId: "10800000", displayedName: "Fixture, Jordan", action: "Terminatn",
  approvalStatus: "Pending", startDate: "11/01/2026", submittedAt: "11/01/26 1:02:03.123456PM", detailVerified: true };
const found = { state: "found", findings: { ...UcpathReadTransactionFindings.example, rows: [row], scannedRowCount: 1,
  completeness: { state: "complete", reportedRowCount: 1 } }, selectorVerification: "pending-live-verification",
  authoritative: false, matches: [{ transactionId: row.transactionId, match: "exact" }] };

describe("UCPath findings wire contract", () => {
  it("distinguishes unavailable from verified empty data and retains the raw Requested text", () => {
    assert.deepEqual(UcpathFindingsDetailSchema.parse({ state: "unavailable" }), { state: "unavailable" });
    const detail = UcpathFindingsDetailSchema.parse(found);
    assert.equal(detail.state, "found");
    if (detail.state === "found") assert.equal(detail.findings.rows[0]?.submittedAt, row.submittedAt);
    assert.equal(UcpathFindingsDetailSchema.safeParse({ ...found,
      findings: UcpathReadTransactionFindings.example, matches: [] }).success, true);
  });

  it("rejects fabricated selector authority and undeclared wire fields", () => {
    for (const patch of [{ authoritative: true }, { selectorVerification: "verified" }, { stale: false }]) {
      assert.equal(UcpathFindingsDetailSchema.safeParse({ ...found, ...patch }).success, false);
    }
    assert.equal(UcpathFindingsDetailSchema.safeParse({ state: "unavailable", findings: found.findings }).success, false);
  });

  it("requires exact ordered row membership for every match", () => {
    for (const matches of [[], [{ transactionId: "T999999", match: "exact" }], [...found.matches, ...found.matches]]) {
      assert.equal(UcpathFindingsDetailSchema.safeParse({ ...found, matches }).success, false);
    }
  });

  it("binds findings to a UCPath termination park", () => {
    assert.equal(ParkedWriteDetailWireSchema.safeParse({ ...FIXTURE_PARKED_WRITE,
      taskId: "ucpath/create-termination", ucpathFindings: found }).success, true);
    assert.equal(ParkedWriteDetailWireSchema.safeParse({ ...FIXTURE_PARKED_WRITE, ucpathFindings: found }).success, false);
    assert.equal(ParkedWriteDetailWireSchema.safeParse({ ...FIXTURE_PARKED_WRITE,
      system: "kuali", taskId: "ucpath/create-termination", ucpathFindings: found }).success, false);
  });

  it("refuses a falsely complete capped population and inconsistent counts", () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ ...row, transactionId: `T${100000 + index}` }));
    const capped = { ...found, findings: { ...found.findings, rows, scannedRowCount: 300,
      completeness: { state: "incomplete", reason: "search-cap", reportedRowCount: 300 } },
      matches: rows.map(candidate => ({ transactionId: candidate.transactionId, match: "exact" })) };
    assert.equal(UcpathFindingsDetailSchema.safeParse(capped).success, true);
    assert.equal(UcpathFindingsDetailSchema.safeParse({ ...capped, findings: { ...capped.findings,
      completeness: { state: "complete", reportedRowCount: 300 } } }).success, false);
    assert.equal(UcpathFindingsDetailSchema.safeParse({ ...found, findings: { ...found.findings, scannedRowCount: 0 } }).success, false);
  });
});
