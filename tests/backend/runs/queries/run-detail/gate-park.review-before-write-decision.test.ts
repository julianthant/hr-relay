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

  it("serves both arms over an all-dropped match: the dropped hits with their reasons first, then a new hire that rules them all out", () => {
    const decision = hireReviewDecision("new-hire", allDropped, NAMES, ARMS, "hire-review", 7);
    assert.deepEqual(decision?.options.map(({ id, send: sent, recommended }) => [id, sent, recommended]),
      [["existing-person", send("existing-person"), true], ["new-hire", send("new-hire"), undefined]]);
    const [existing, newHire] = decision?.options ?? [];
    assert.ok(existing?.input?.kind === "candidate");
    assert.equal(existing.input.table.title, "UCPath matches");
    assert.equal(existing.input.table.typed, undefined);
    assert.deepEqual(existing.input.table.rows.map(row => [row.id, row.cells]), DROPPED.map(hit => [hit.emplId, [
      { columnId: "name", value: hit.name }, { columnId: "eid", value: `••••${hit.emplId.slice(-4)}` },
      { columnId: "check", value: "Last name does not match", tone: "attention" }]]));
    assert.equal(existing.confirm?.tone, "destructive");
    assert.equal(newHire?.label, "File as a new hire");
    assert.equal(newHire?.confirm?.tone, "destructive");
    assert.match(newHire?.confirm?.body ?? "", /all 3 UCPath matches/u);
    assert.match(decision?.context ?? "", /UCPath returned 3 possible matches and Relay confirmed none\. Searched by name, date of birth and SSN\.$/u);
    assert.match(hireReviewDecision("new-hire", allDropped, { ...NAMES, ssn: null }, ARMS, "hire-review", 7)?.context ?? "", /Searched by name and date of birth\.$/u);
  });

  it("serves only the dropped hits for a concurrent hire, and never the SSN", () => {
    const decision = hireReviewDecision("rehire", allDropped, NAMES, ARMS, "hire-review", 7);
    assert.deepEqual(decision?.options.map(({ id }) => id), ["existing-person"]);
    assert.equal(JSON.stringify(decision).includes(SSN), false);
  });

  it("serves no decision when a hit is left unclassified", () => {
    assert.equal(hireReviewDecision("new-hire", SearchPersonMatchOutputSchema.parse({ hits: [PERSON], confirmed: [], dropped: [] }), NAMES, ARMS, "hire-review", 7), undefined);
  });
});
