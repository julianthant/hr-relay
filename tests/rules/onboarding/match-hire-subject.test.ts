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

  it("serves a new hire only when Person Org confirmed nobody, and existing people from the confirmed or else the same-name dropped hits", () => {
    const hire = { firstName: "Fixture", middleName: "", lastName: "Hire" };
    assert.deepEqual(hireReviewChoices("new-hire", base.match, hire), { newHire: true, existing: [] });
    const confirmed = { hits: [person, other], confirmed: [person], dropped: [{ ...other, reason: "Last name does not match" }] };
    assert.deepEqual(hireReviewChoices("new-hire", confirmed, hire), { newHire: false, existing: [{ ...person, confirmedBy: "person-org" }] });
    const dropped = { hits: [person, other], confirmed: [], dropped: [{ ...person, reason: "No Person Org record" }, { ...other, reason: "Last name does not match" }] };
    assert.deepEqual(hireReviewChoices("new-hire", dropped, hire), { newHire: true, existing: [{ ...person, confirmedBy: "operator", reason: "No Person Org record" }] },
      "a hit under another name is never offered: the UCPath hire scans and checks identity by the hire's name");
    assert.deepEqual(hireReviewChoices("new-hire", dropped, { firstName: "FIXTURE", middleName: "", lastName: "hire" }).existing.map(entry => entry.emplId), [person.emplId]);
    assert.equal(hireReviewChoices("rehire", dropped, hire).newHire, false);
    const hyphenated = { firstName: "Fixture", middleName: "", lastName: "Hire-Person" };
    const spaced = { ...person, name: "Hire Person, Fixture" }, exact = { ...other, name: "hire-person,  FIXTURE" };
    const punctuation = { hits: [spaced, exact], confirmed: [], dropped: [{ ...spaced, reason: "No Person Org record" }, { ...exact, reason: "No Person Org record" }] };
    assert.deepEqual(hireReviewChoices("rehire", punctuation, hyphenated).existing.map(entry => entry.emplId), [exact.emplId],
      "only the case- and spacing-equal forms the UCPath hire accepts are offered, never a punctuation-equal one");
    assert.throws(() => hireReviewChoices("new-hire", { hits: [person], confirmed: [], dropped: [] }, hire), /did not classify every person/u);
  });
});
