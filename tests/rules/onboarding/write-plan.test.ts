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
  subject: { state: "new-hire", candidateEids: [] }, lookup: OnboardingReadI9Lookup.example, approval: { decision: "new-hire", ruledOut: [] } });
const person = { emplId: EidSchema.parse("10800000"), name: "Hire, Fixture" };
const confirmed = { hits: [person], confirmed: [person], dropped: [] };
const existing = OnboardingReadWritePlan.input.parse({ ...base, match: confirmed,
  subject: matchHireSubject({ mode: "new-hire", firstName: "Fixture", lastName: "Hire", match: confirmed }),
  lookup: { state: "not-required", subjectState: "existing-person" }, approval: { decision: "existing-person", emplId: person.emplId, confirmedBy: "person-org" } });

// 10800002 carries the hire's own name (dropped for another reason); the others are under another name.
const hits = ["10800003", "10800001", "10800002"].map(emplId => ({ emplId: EidSchema.parse(emplId), name: emplId === "10800002" ? "Hire, Fixture" : "Other, Person" }));
const allDropped = SearchPersonMatchOutputSchema.parse({ hits, confirmed: [], dropped: hits.map(hit => ({ ...hit, reason: "Last name does not match" })) });
const checked = { state: "checked" as const, childRunId: "aaaaaaaa-0001-4000-8000-000100000001", result: { i9Status: "not-found" as const, signerName: "" as const } };
const unconfirmed = OnboardingReadWritePlan.input.parse({ ...base, match: allDropped, lookup: checked,
  subject: matchHireSubject({ mode: "new-hire", firstName: "Fixture", lastName: "Hire", match: allDropped }),
  approval: { decision: "new-hire", ruledOut: ["10800001", "10800002", "10800003"] } });

describe("reviewed onboarding write plan", () => {
  it("files a new hire over an all-dropped match only when the operator ruled out every hit", () => {
    assert.equal(unconfirmed.subject.state, "review-required");
    const result = readOnboardingWritePlan(unconfirmed);
    assert.equal(result.hire.mode, "new-hire"); assert.equal(result.hire.emplId, null); assert.notEqual(result.i9, null);
    assert.deepEqual(result.subject, { state: "new-hire", candidateEids: [] });
    for (const ruledOut of [["10800001", "10800002"], ["10800001", "10800002", "10800004"], []]) {
      assert.throws(() => readOnboardingWritePlan({ ...unconfirmed, approval: { decision: "new-hire", ruledOut } }), /new-hire-choice-has-existing-or-unresolved-identity/u);
    }
    assert.throws(() => readOnboardingWritePlan({ ...unconfirmed, lookup: { state: "not-required", subjectState: "review-required" } }), /i9-skip-source-disagrees/u);
    assert.throws(() => readOnboardingWritePlan({ ...unconfirmed, mode: "rehire",
      subject: matchHireSubject({ mode: "rehire", firstName: "Fixture", lastName: "Hire", match: allDropped }),
      lookup: { state: "not-required", subjectState: "review-required" } }), /new-hire-choice-has-existing-or-unresolved-identity/u);
  });
  it("files a concurrent hire under a same-name dropped hit the operator picked, and nothing else overrides a drop", () => {
    const picked = { ...unconfirmed, approval: { decision: "existing-person" as const, emplId: EidSchema.parse("10800002"), confirmedBy: "operator" as const } };
    const result = readOnboardingWritePlan(picked);
    assert.equal(result.hire.mode, "rehire"); assert.equal(result.hire.emplId, "10800002");
    assert.equal(result.hire.expectedName, "Hire, Fixture"); assert.equal(result.i9, null);
    assert.throws(() => readOnboardingWritePlan({ ...picked, approval: { ...picked.approval, emplId: EidSchema.parse("10800001") } }), /existing-hire-choice-not-independently-confirmed/u,
      "a dropped hit under another name is refused: the UCPath hire scans and checks identity by the hire's name");
    assert.throws(() => readOnboardingWritePlan({ ...picked, approval: { ...picked.approval, confirmedBy: "person-org" } }), /existing-hire-choice-not-independently-confirmed/u);
    assert.throws(() => readOnboardingWritePlan({ ...picked, approval: { ...picked.approval, emplId: EidSchema.parse("10800004") } }), /existing-hire-choice-not-independently-confirmed/u);
    const squeezed = { emplId: EidSchema.parse("10800004"), name: "HIRE,FIXTURE" };
    const punctuation = SearchPersonMatchOutputSchema.parse({ hits: [squeezed], confirmed: [], dropped: [{ ...squeezed, reason: "No Person Org record" }] });
    assert.throws(() => readOnboardingWritePlan({ ...picked, match: punctuation, subject: matchHireSubject({ mode: "new-hire", firstName: "Fixture", lastName: "Hire", match: punctuation }),
      approval: { ...picked.approval, emplId: squeezed.emplId } }), /existing-hire-choice-not-independently-confirmed/u,
    "a name equal only after punctuation is refused before the UCPath hire query, which accepts case and spacing alone");
  });
  it("refuses an operator pick or a new hire while Person Org confirmed a hit", () => {
    const other = { emplId: EidSchema.parse("10800001"), name: "Other, Person" };
    const mixed = SearchPersonMatchOutputSchema.parse({ hits: [person, other], confirmed: [person], dropped: [{ ...other, reason: "Last name does not match" }] });
    const input = { ...existing, match: mixed, subject: matchHireSubject({ mode: "new-hire", firstName: "Fixture", lastName: "Hire", match: mixed }),
      lookup: { state: "not-required" as const, subjectState: "review-required" as const } };
    assert.equal(readOnboardingWritePlan(input).hire.emplId, person.emplId);
    assert.throws(() => readOnboardingWritePlan({ ...input, approval: { decision: "existing-person", emplId: other.emplId, confirmedBy: "operator" } }), /existing-hire-choice-not-independently-confirmed/u);
    assert.throws(() => readOnboardingWritePlan({ ...input, approval: { decision: "existing-person", emplId: person.emplId, confirmedBy: "operator" } }), /existing-hire-choice-not-independently-confirmed/u);
    assert.throws(() => readOnboardingWritePlan({ ...input, approval: { decision: "new-hire", ruledOut: [person.emplId, other.emplId] } }), /new-hire-choice-has-existing-or-unresolved-identity/u);
  });
  it("accepts a confirmed person whose name differs from its hit only in case or punctuation", () => {
    const hit = { emplId: person.emplId, name: "HIRE,FIXTURE" };
    const cased = SearchPersonMatchOutputSchema.parse({ hits: [hit], confirmed: [{ ...hit, name: "Hire, Fixture" }], dropped: [] });
    const result = readOnboardingWritePlan({ ...existing, match: cased, subject: matchHireSubject({ mode: "new-hire", firstName: "Fixture", lastName: "Hire", match: cased }) });
    assert.equal(result.hire.emplId, person.emplId);
  });
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
    assert.throws(() => readOnboardingWritePlan({ ...existing, approval: { decision: "existing-person", emplId: "10800001", confirmedBy: "person-org" } }));
    assert.throws(() => readOnboardingWritePlan({ ...existing, approval: { decision: "existing-person", emplId: person.emplId, confirmedBy: "operator" } }));
    assert.throws(() => readOnboardingWritePlan({ ...existing, approval: { decision: "new-hire", ruledOut: [person.emplId] } }));
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
