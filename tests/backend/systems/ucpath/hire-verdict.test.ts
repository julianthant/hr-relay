import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ucpathHireVerdict } from "../../../../src/backend/systems/ucpath/hire-verdict.js";
import { UcpathHireQuerySchema, UcpathHireScanSchema, UCPATH_HIRE_PROOF_EXAMPLE } from "../../../../src/models/ui/ucpath-hire.js";
import { OnboardingReadHirePlan } from "../../../../src/models/workflows/onboarding/read-hire-plan.js";
const query = UcpathHireQuerySchema.parse({ mode: "new-hire", employee: OnboardingReadHirePlan.example.employee, expectedName: "Fixture Hire", emplId: null });
const { kind: _kind, source: _source, ...row } = UCPATH_HIRE_PROOF_EXAMPLE;
const scan = (rows: unknown[], state = "complete") => UcpathHireScanSchema.parse({ state, rows, observedAt: "2026-09-01T18:00:00.000Z", source: "ss-smart-hr-list-and-detail" });
describe("UCPath hire proof", () => {
  it("requires complete absence and binds that observation to this event key", () => {
    const verdict = ucpathHireVerdict(query, scan([])); assert.equal(verdict.state, "absent");
    assert.equal(ucpathHireVerdict(query, scan([], "incomplete")).state, "unknown");
  });
  it("accepts only an exact independently read identity, job and filing status", () => {
    for (const approvalStatus of ["Pending", "Approved", "Manually Processed"]) assert.equal(ucpathHireVerdict(query, scan([{ ...row, approvalStatus }])).state, "present");
    for (const change of [{ approvalStatus: "Denied" }, { approvalStatus: "Error" }, { approvalStatus: "Pushed Back" },
      { email: "other@example.test" }, { dob: "2000-01-15" }, { displayedName: "Different Person" }]) {
      assert.equal(ucpathHireVerdict(query, scan([{ ...row, ...change }])).state, "unknown");
    }
  });
  it("refuses multiple saved hires and a concurrent hire for a different resolved EID", () => {
    assert.equal(ucpathHireVerdict(query, scan([row, { ...row, transactionId: "T009000002" }])).state, "ambiguous");
    const rehire = UcpathHireQuerySchema.parse({ ...query, mode: "rehire", emplId: "10800000" });
    assert.equal(ucpathHireVerdict(rehire, scan([{ ...row, emplId: "10800001" }])).state, "unknown");
    assert.equal(ucpathHireVerdict(rehire, scan([{ ...row, emplId: "10800000" }])).state, "present");
  });
});
