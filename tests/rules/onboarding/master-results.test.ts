import { EidSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { onboardingMasterResults } from "../../../src/rules/onboarding/master-results.js";
import { OnboardingReadWritePlan } from "../../../src/models/workflows/onboarding/read-write-plan.js";
import { UCPATH_HIRE_PROOF_EXAMPLE } from "../../../src/models/ui/ucpath-hire.js";
import { I9CreateRemoteRecord } from "../../../src/models/systems/i9/create-remote-record.js";
import { DRY_RUN_I9_PROFILE_ID } from "../../../src/models/workflow/dry-run.js";

const plan = OnboardingReadWritePlan.example, hire = UCPATH_HIRE_PROOF_EXAMPLE, remote = I9CreateRemoteRecord.example.receipt;
describe("verified onboarding master cells", () => {
  it("uses the captured work-email row key and only independently read result values", () => {
    const input = { ...plan, roster: { ...plan.roster, rowKey: { email: "work@example.test" } } };
    const result = onboardingMasterResults(input, hire, remote);
    assert.equal(result.kind, "patch-reference"); assert.equal(result.key, "work@example.test");
    assert.deepEqual(result.values, [{ fieldId: "transactionNumber", value: hire.transactionId }]);
    assert.equal(result.typeId, "onboarding-roster"); assert.equal(result.writeId, "onboarding-results");
  });
  it("includes an assigned EID only when present in the verified UCPath detail", () => {
    const result = onboardingMasterResults(plan, { ...hire, emplId: EidSchema.parse("10800000") }, remote);
    assert.equal(result.values.find(cell => cell.fieldId === "eid")?.value, "10800000");
    const existing = { ...plan, hire: { ...plan.hire, mode: "rehire" as const, emplId: EidSchema.parse("10800000") }, i9: null };
    const concurrent = onboardingMasterResults(existing, { ...hire, emplId: EidSchema.parse("10800000"), profileId: null }, null);
    assert.deepEqual(Object.fromEntries(concurrent.values.map(cell => [cell.fieldId, cell.value])), { transactionNumber: hire.transactionId, eid: "10800000" });
    assert.throws(() => onboardingMasterResults(existing, { ...hire, emplId: EidSchema.parse("10800000"), profileId: null }, remote));
    assert.throws(() => onboardingMasterResults(existing, { ...hire, emplId: EidSchema.parse("10800000") }, null));
  });
  it("refuses mismatched identities, jobs, profile links, record dates and all preview values", () => {
    for (const change of [{ email: "wrong@example.test" }, { effectiveDate: "09/12/2026" }, { profileId: "900003" },
      { positionNumber: "12345679" }, { profileId: DRY_RUN_I9_PROFILE_ID }, { transactionId: "T000000000000" }]) {
      assert.throws(() => onboardingMasterResults(plan, { ...hire, ...change }, remote));
    }
    assert.throws(() => onboardingMasterResults(plan, hire, { ...remote, startDate: "09/12/2026" }));
    assert.throws(() => onboardingMasterResults(plan, hire, null));
  });
});
