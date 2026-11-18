import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PersonLookupInput, PersonLookupCanonicalInput, personLookupSearchText, personLookupTitle } from "../../../../src/models/workflows/person-lookup/input.js";

describe("Person Lookup input", () => {
  it("masks SSN in Match display identity", () => {
    const person = PersonLookupInput.parse({ mode: "match", lastName: "Example", firstName: "Person, Middle", dob: "01/15/2000", ssn: "123456789" });
    assert.ok(person.mode === "match");
    assert.equal(person.crmCheck, false);
    assert.equal(personLookupSearchText(person), "Example, Person, Middle, 01/15/2000, [masked]");
    assert.equal(personLookupTitle(person), "Example, Person, Middle");
  });
  it("accepts an SSN typed with dashes and stores nine digits", () => {
    const person = PersonLookupInput.parse({ mode: "match", lastName: "Lee", firstName: "Jordan", dob: "01/01/2000", ssn: "123-45-6789" });
    assert.ok(person.mode === "match");
    assert.equal(person.ssn, "123456789");
    assert.equal(PersonLookupCanonicalInput.safeParse(person).success, true);
    assert.equal(PersonLookupInput.safeParse({ mode: "match", lastName: "Lee", firstName: "Jordan", ssn: "000 12 3456" }).success, false);
  });
  it("refuses invalid explicit submissions and canonical snapshots without defaults", () => {
    for (const submission of [
      { mode: "match", lastName: "Example", firstName: "Person", dob: "x" },
      { mode: "match", lastName: "Example", firstName: "Person", dob: "X" },
      { mode: "match", lastName: "Example", firstName: "Person" },
      { mode: "match", lastName: "Example", firstName: "Person", ssn: "123456789", includeCrmDates: true },
      { mode: "search", name: "Example, Person", crmCheck: false, includeCrmDates: true },
    ]) assert.equal(PersonLookupInput.safeParse(submission).success, false);
    assert.equal(PersonLookupCanonicalInput.safeParse({ name: "Example, Person" }).success, false);
    assert.equal(PersonLookupCanonicalInput.safeParse({ mode: "match", lastName: "Example", firstName: "Person", dob: "x", crmCheck: false, includeCrmDates: false }).success, false);
  });
});
