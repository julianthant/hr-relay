import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PersonLookupInput, PersonLookupCanonicalInput, parsePersonLookupRequest, personLookupSearchText, personLookupTitle } from "../../../../src/models/workflows/person-lookup/input.js";

describe("Person Lookup input", () => {
  it("merges normalized duplicates and discriminates only eight-digit 10 IDs", () => {
    const people = parsePersonLookupRequest("10000001; Example, Person\nexample,   person;12345");
    assert.equal(people.length, 3);
    assert.equal(people[0]?.mode, "search");
    assert.equal(people[0]?.crmCheck, true);
    assert.equal("emplId" in people[2], false);
  });
  it("reads DOB and SSN from the final fields and masks display identity", () => {
    const [person] = parsePersonLookupRequest("Example, Person, Middle, 01/15/2000, 123456789", { mode: "match" });
    assert.ok(person?.mode === "match");
    assert.equal(person.firstName, "Person, Middle");
    assert.equal(person.crmCheck, false);
    assert.equal(personLookupSearchText(person), "Example, Person, Middle, 01/15/2000, [masked]");
    assert.equal(personLookupTitle(person), "Example, Person, Middle");
  });
  it("rejects empty, underspecified and double-missing Match entries", () => {
    for (const text of ["", "Example, Person", "Example, Person, x, X"]) assert.throws(() => parsePersonLookupRequest(text, { mode: "match" }));
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
