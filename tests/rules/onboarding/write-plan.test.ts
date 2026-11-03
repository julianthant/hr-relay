import { EidSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readOnboardingWritePlan } from "../../../src/rules/onboarding/write-plan.js";
import { matchHireSubject } from "../../../src/rules/onboarding/match-hire-subject.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingReadWritePlan } from "../../../src/models/workflows/onboarding/read-write-plan.js";
import { OnboardingReadI9Lookup } from "../../../src/models/workflows/onboarding/read-i9-lookup.js";
import { SearchPersonMatchOutputSchema } from "../../../src/models/systems/ucpath/search-person-match.js";
import { UcpathHireScanSchema, UCPATH_HIRE_PROOF_EXAMPLE, ucpathHireSearchDigest } from "../../../src/models/ui/ucpath-hire.js";

const plan = OnboardingReadHirePlan.example;
const match = SearchPersonMatchOutputSchema.parse({ hits: [], confirmed: [], dropped: [] });
const findings = UcpathHireScanSchema.parse({ state: "complete", rows: [], queryDigest: ucpathHireSearchDigest(plan.employee),
  source: "ss-smart-hr-list-and-detail", observedAt: "2026-09-01T18:00:00.000Z" });
const base = OnboardingReadWritePlan.input.parse({ mode: "new-hire", plan, match, findings,
  subject: { state: "new-hire", candidateEids: [] }, lookup: OnboardingReadI9Lookup.example, approval: { decision: "new-hire" } });
const person = { emplId: EidSchema.parse("10800000"), name: "Hire, Fixture" };
const confirmed = { hits: [person], confirmed: [person], dropped: [] };
const existing = OnboardingReadWritePlan.input.parse({ ...base, match: confirmed,
  subject: matchHireSubject({ mode: "new-hire", firstName: "Fixture", lastName: "Hire", match: confirmed }),
  lookup: { state: "not-required", subjectState: "existing-person" }, approval: { decision: "existing-person", emplId: person.emplId } });

describe("reviewed onboarding write plan", () => {
  it("binds an empty UCPath match and complete findings to the captured row and full new-hire targets", () => {
    const result = readOnboardingWritePlan(base);
    assert.deepEqual(result.roster, plan.roster); assert.deepEqual(result.hire.employee, plan.employee);
    assert.equal(result.hire.mode, "new-hire"); assert.equal(result.hire.emplId, null);
    assert.equal(result.i9?.dob, plan.employee.dob); assert.match(result.comments, /EE does not have an SSN yet/u);
  });
  it("requires an independently confirmed, legal-name-matched EID before skipping I-9 and filing a concurrent hire", () => {
    const result = readOnboardingWritePlan(existing);
    assert.equal(result.hire.mode, "rehire"); assert.equal(result.hire.emplId, person.emplId);
    assert.equal(result.hire.expectedName, person.name); assert.equal(result.i9, null);
    assert.match(result.comments, /Concurrent Hire as Dining Student/u);
    assert.throws(() => readOnboardingWritePlan({ ...existing, approval: { decision: "existing-person", emplId: "10800001" } }));
    assert.throws(() => readOnboardingWritePlan({ ...existing, approval: { decision: "new-hire" } }));
    assert.throws(() => readOnboardingWritePlan({ ...base, approval: existing.approval }));
  });
  it("refuses altered match classifications, an inaccessible lookup and incomplete or foreign findings", () => {
    for (const change of [
      { subject: { state: "existing-person", person } },
      { lookup: { state: "checked", childRunId: "aaaaaaaa-0001-4000-8000-000100000001", result: { i9Status: "unable-to-access", signerName: "" } } },
      { findings: { ...findings, state: "incomplete" } },
      { findings: { ...findings, queryDigest: "f".repeat(64) } },
    ] as const) assert.throws(() => readOnboardingWritePlan({ ...base, ...change }));
  });
  it("requires a saved new-hire filing to link the independently found I-9 profile", () => {
    const { kind: _kind, source: _source, ...row } = UCPATH_HIRE_PROOF_EXAMPLE;
    const filed = { ...base, findings: { ...findings, rows: [row] } };
    assert.throws(() => readOnboardingWritePlan(filed));
    const lookup = { state: "checked" as const, childRunId: "aaaaaaaa-0001-4000-8000-000100000001", result: {
      i9Status: "unsigned" as const, signerName: "" as const, profileId: "900001", i9Id: "900002" } };
    assert.equal(readOnboardingWritePlan({ ...filed, lookup }).hire.mode, "new-hire");
    assert.throws(() => readOnboardingWritePlan({ ...filed, lookup: { ...lookup, result: { ...lookup.result, profileId: "900003" } } }));
  });
});
