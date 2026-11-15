import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hireReviewDecision } from "../../../../../src/backend/runs/queries/run-detail/gate-park.js";
import { gateDecisionFor } from "../../../../../src/models/trust/gate-decisions.js";
import { SearchPersonMatchOutputSchema } from "../../../../../src/models/systems/ucpath/search-person-match.js";

const ARMS = gateDecisionFor("onboarding", "hire-review").arms;
const PERSON = { emplId: "10001234", name: "Fixture Person" };
const SSN = "123456789";
const NAMES = { firstName: "Jonathan", middleName: "Michael", lastName: "Smith", preferredFirstName: "Jon", preferredMiddleName: "", preferredLastName: "Smith", ssn: SSN };
const send = (arm: string) => ({ via: "gate-arm", gateNodeId: "hire-review", expectedVersion: 7, arm });
const DROPPED = ["10000001", "10000002", "10000003"].map(emplId => ({ emplId, name: "Other, Person" }));
const allDropped = SearchPersonMatchOutputSchema.parse({ hits: DROPPED, confirmed: [], dropped: DROPPED.map(hit => ({ ...hit, reason: "Last name does not match" })) });

describe("hireReviewDecision", () => {
  it("serves only Approve new hire when the match found nobody", () => {
    const decision = hireReviewDecision("new-hire", SearchPersonMatchOutputSchema.parse({ hits: [], confirmed: [], dropped: [] }), NAMES, ARMS, "hire-review", 7);
    assert.equal(decision?.type, "review-before-write");
    assert.deepEqual(decision?.options.map(({ id, send: sent, recommended, input }) => [id, sent, recommended, input]),
      [["new-hire", send("new-hire"), true, undefined]]);
    assert.equal(decision?.context, "Legal name: first Jonathan, middle Michael, last Smith. Preferred name: first Jon, no middle name, last Smith.");
  });

  it("serves Use existing employee with only the Person Org confirmed matches, and no new hire", () => {
    const other = { emplId: "10000002", name: "Dropped Person" };
    const decision = hireReviewDecision("new-hire", SearchPersonMatchOutputSchema.parse({ hits: [PERSON, other], confirmed: [PERSON], dropped: [{ ...other, reason: "dob" }] }), NAMES, ARMS, "hire-review", 7);
    assert.deepEqual(decision?.options.map(({ id }) => id), ["existing-person"]);
    const input = decision?.options[0]?.input;
    assert.equal(input?.kind, "candidate");
    assert.deepEqual(input?.kind === "candidate" ? input.table.rows : undefined, [{ id: PERSON.emplId, name: PERSON.name, eid: PERSON.emplId,
      cells: [{ columnId: "name", value: PERSON.name }, { columnId: "eid", value: "••••1234" }] }]);
    assert.equal(input?.kind === "candidate" ? input.table.typed : "absent", undefined, "an existing EID is never typed");
    assert.equal(decision?.options[0]?.confirm, undefined);
  });

  it("serves both arms over an all-dropped match: the same-name dropped hit first, then a new hire that rules every hit out", () => {
    const sameName = { emplId: "10000002", name: "Smith, Jonathan" };
    const hits = [DROPPED[0], sameName, DROPPED[2]];
    const match = SearchPersonMatchOutputSchema.parse({ hits, confirmed: [],
      dropped: [{ ...DROPPED[0], reason: "Last name does not match" }, { ...sameName, reason: "No Person Org record" }, { ...DROPPED[2], reason: "Last name does not match" }] });
    const decision = hireReviewDecision("new-hire", match, NAMES, ARMS, "hire-review", 7);
    assert.deepEqual(decision?.options.map(({ id, send: sent, recommended }) => [id, sent, recommended]),
      [["existing-person", send("existing-person"), true], ["new-hire", send("new-hire"), undefined]]);
    const [existing, newHire] = decision?.options ?? [];
    assert.ok(existing?.input?.kind === "candidate");
    assert.equal(existing.input.table.title, "UCPath matches");
    assert.equal(existing.input.table.typed, undefined);
    assert.deepEqual(existing.input.table.rows.map(row => [row.id, row.cells]), [[sameName.emplId, [
      { columnId: "name", value: sameName.name }, { columnId: "eid", value: "••••0002" }, { columnId: "check", value: "No Person Org record", tone: "attention" }]]]);
    assert.equal(existing.confirm?.tone, "destructive");
    assert.equal(newHire?.label, "File as a new hire");
    assert.equal(newHire?.confirm?.tone, "destructive");
    assert.match(newHire?.confirm?.body ?? "", /all 3 UCPath matches/u);
    assert.match(decision?.context ?? "", /UCPath returned 3 possible matches and Relay confirmed none\. Searched by name, date of birth and SSN\. Under another name: Other, Person \(••••0001\): Last name does not match; Other, Person \(••••0003\): Last name does not match\. Relay cannot file a hire under another name\. If one of them is this person, cancel this run and file the rehire by hand in UCPath\.$/u);
  });

  it("never offers a dropped hit under another name: it lists them with their reasons and the manual rehire path", () => {
    const decision = hireReviewDecision("new-hire", allDropped, NAMES, ARMS, "hire-review", 7);
    assert.deepEqual(decision?.options.map(({ id }) => id), ["new-hire"]);
    assert.equal(JSON.stringify(decision?.options).includes("10000001"), false, "no option carries a different-name hit");
    assert.match(decision?.context ?? "", /Under another name: Other, Person \(••••0001\): Last name does not match; Other, Person \(••••0002\): Last name does not match; Other, Person \(••••0003\): Last name does not match\. Relay cannot file a hire under another name\./u);
    assert.match(hireReviewDecision("new-hire", allDropped, { ...NAMES, ssn: null }, ARMS, "hire-review", 7)?.context ?? "", /Searched by name and date of birth\. Under another name/u);
  });

  it("serves only the same-name dropped hits for a concurrent hire, only the manual rehire path when none carries the name, and never the SSN", () => {
    const deadEnd = hireReviewDecision("rehire", allDropped, NAMES, ARMS, "hire-review", 7);
    assert.deepEqual(deadEnd?.options, [], "no arm is answerable, but the card is served instead of a bare Waiting");
    assert.match(deadEnd?.context ?? "", /Under another name: Other, Person \(••••0001\): Last name does not match;.*cancel this run and file the rehire by hand in UCPath\./u);
    const spaced = { emplId: "10000004", name: "Smith Jones, Jonathan" };
    const punctuation = hireReviewDecision("rehire", SearchPersonMatchOutputSchema.parse({ hits: [spaced], confirmed: [], dropped: [{ ...spaced, reason: "No Person Org record" }] }),
      { ...NAMES, lastName: "Smith-Jones" }, ARMS, "hire-review", 7);
    assert.deepEqual(punctuation?.options, [], "a name equal only after punctuation is never offered: the UCPath hire accepts case and spacing alone");
    assert.match(punctuation?.context ?? "", /Under another name: Smith Jones, Jonathan \(••••0004\): No Person Org record\./u);
    const sameName = { emplId: "10000002", name: "Smith, Jonathan" };
    const decision = hireReviewDecision("rehire", SearchPersonMatchOutputSchema.parse({ hits: [sameName], confirmed: [], dropped: [{ ...sameName, reason: "No Person Org record" }] }), NAMES, ARMS, "hire-review", 7);
    assert.deepEqual(decision?.options.map(({ id }) => id), ["existing-person"]);
    assert.equal(JSON.stringify(decision).includes(SSN), false);
    assert.equal(JSON.stringify(hireReviewDecision("new-hire", allDropped, NAMES, ARMS, "hire-review", 7)).includes(SSN), false);
  });

  it("serves no decision when a hit is left unclassified", () => {
    assert.equal(hireReviewDecision("new-hire", SearchPersonMatchOutputSchema.parse({ hits: [PERSON], confirmed: [], dropped: [] }), NAMES, ARMS, "hire-review", 7), undefined);
  });
});
