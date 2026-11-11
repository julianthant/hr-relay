import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { hireReviewChoices, matchHireSubject } from "../../../src/rules/onboarding/match-hire-subject.js";

const person = { emplId: EidSchema.parse("10800000"), name: "Hire, Fixture" };
const other = { emplId: EidSchema.parse("10800001"), name: "Hire, Other" };
const base = { mode: "new-hire" as const, firstName: "Fixture", lastName: "Hire", match: { hits: [], confirmed: [], dropped: [] } };

describe("onboarding duplicate identity", () => {
  it("continues a new hire only after a complete empty UCPath search", () => {
    assert.deepEqual(matchHireSubject(base), { state: "new-hire", candidateEids: [] });
    assert.throws(() => matchHireSubject({ ...base, mode: "rehire" }), /requires an existing/u);
  });

  it("stops a new hire with one exact confirmed person and requires operator review for concurrent hire", () => {
    const match = { hits: [person], confirmed: [person], dropped: [] };
    assert.deepEqual(matchHireSubject({ ...base, match }), { state: "existing-person", person });
    assert.deepEqual(matchHireSubject({ ...base, mode: "rehire", match }), { state: "review-required", candidates: [person] });
  });

  it("requires review for different names, multiple hits, and dropped fuzzy candidates", () => {
    for (const match of [
      { hits: [other], confirmed: [other], dropped: [] },
      { hits: [person, other], confirmed: [person, other], dropped: [] },
      { hits: [other], confirmed: [], dropped: [{ ...other, reason: "Last name does not match" }] },
    ]) {
      assert.deepEqual(matchHireSubject({ ...base, match }), { state: "review-required", candidates: match.hits });
    }
  });

  it("refuses missing, conflicting, duplicate or foreign confirmation evidence", () => {
    for (const match of [
      { hits: [], confirmed: [person], dropped: [] },
      { hits: [person], confirmed: [], dropped: [] },
      { hits: [person], confirmed: [other], dropped: [] },
      { hits: [person], confirmed: [{ ...person, name: "Different, Person" }], dropped: [] },
      { hits: [person, person], confirmed: [person], dropped: [] },
      { hits: [person], confirmed: [person], dropped: [{ ...person, reason: "not confirmed" }] },
    ]) assert.throws(() => matchHireSubject({ ...base, match }));
  });

  it("serves a new hire only when Person Org confirmed nobody, and existing people from the confirmed or else the dropped hits", () => {
    assert.deepEqual(hireReviewChoices("new-hire", base.match), { newHire: true, existing: [] });
    const confirmed = { hits: [person, other], confirmed: [person], dropped: [{ ...other, reason: "Last name does not match" }] };
    assert.deepEqual(hireReviewChoices("new-hire", confirmed), { newHire: false, existing: [{ ...person, confirmedBy: "person-org" }] });
    const dropped = { hits: [person, other], confirmed: [], dropped: [{ ...person, reason: "No Person Org record" }, { ...other, reason: "Last name does not match" }] };
    assert.deepEqual(hireReviewChoices("new-hire", dropped), { newHire: true, existing: [
      { ...person, confirmedBy: "operator", reason: "No Person Org record" }, { ...other, confirmedBy: "operator", reason: "Last name does not match" }] });
    assert.equal(hireReviewChoices("rehire", dropped).newHire, false);
    assert.throws(() => hireReviewChoices("new-hire", { hits: [person], confirmed: [], dropped: [] }), /did not classify every person/u);
  });
});
