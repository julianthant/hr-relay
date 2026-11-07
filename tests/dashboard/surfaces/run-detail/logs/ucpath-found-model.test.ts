import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ucpathFoundPresentation } from "../../../../../src/dashboard/surfaces/run-detail/logs/ucpath-found-model.js";
import { UcpathFindingsDetailSchema } from "../../../../../src/models/dashboard/ucpath-findings.js";

const row = { transactionId: "T123456", emplId: "10800000", displayedName: "Fixture, Jordan", action: "Terminatn",
  approvalStatus: "Pending", startDate: "11/01/2026", submittedAt: "11/01/26 1:02:03.123456PM", detailVerified: true };
function detailOf(rows = [row]) {
  return UcpathFindingsDetailSchema.parse({ state: "found", findings: { state: "read", emplId: row.emplId,
    rows, scannedRowCount: rows.length, completeness: rows.length === 300
      ? { state: "incomplete", reason: "search-cap", reportedRowCount: 300 } : { state: "complete", reportedRowCount: rows.length },
    observedAt: "2026-11-01T21:03:00.000Z", source: "ss-smart-hr-list-and-detail" },
    matches: rows.map(candidate => ({ transactionId: candidate.transactionId, match: "exact" })),
    authoritative: false, selectorVerification: "pending-live-verification" });
}

describe("served UCPath found presentation", () => {
  it("maps retained row values without replacing Requested with an observed instant", () => {
    assert.deepEqual(ucpathFoundPresentation(detailOf()), { state: "found", complete: true, authoritative: false, rows: [{
      transactionNumber: "T123456", person: "Fixture, Jordan", employeeId: "10800000", transactionType: "Terminatn",
      effectiveDate: "11/01/2026", submittedAt: "11/01/26 1:02:03.123456PM", detailVerified: true, match: "exact",
    }] });
  });
  it("keeps unavailable, verified empty and capped results distinct and non-authoritative", () => {
    assert.deepEqual(ucpathFoundPresentation({ state: "unavailable" }), { state: "unavailable" });
    assert.deepEqual(ucpathFoundPresentation(detailOf([])), { state: "found", complete: true, authoritative: false, rows: [] });
    const capped = ucpathFoundPresentation(detailOf(Array.from({ length: 300 }, (_, index) => ({ ...row, transactionId: `T${100000 + index}` }))));
    assert.equal(capped.state, "found");
    if (capped.state === "found") { assert.equal(capped.rows.length, 300); assert.equal(capped.complete, false); assert.equal(capped.authoritative, false); }
  });
});
