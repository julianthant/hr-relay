import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hireReviewDecision } from "../../../../../src/backend/runs/queries/run-detail/gate-park.js";
import { gateDecisionFor } from "../../../../../src/models/trust/gate-decisions.js";
import { SearchPersonMatchOutputSchema } from "../../../../../src/models/systems/ucpath/search-person-match.js";

const ARMS = gateDecisionFor("onboarding", "hire-review").arms;
const PERSON = { emplId: "10001234", name: "Fixture Person" };
const send = (arm: string) => ({ via: "gate-arm", gateNodeId: "hire-review", expectedVersion: 7, arm });

describe("hireReviewDecision", () => {
  it("serves only Approve new hire when the match found nobody", () => {
    const decision = hireReviewDecision(SearchPersonMatchOutputSchema.parse({ hits: [], confirmed: [], dropped: [] }), ARMS, "hire-review", 7);
    assert.equal(decision?.type, "review-before-write");
    assert.deepEqual(decision?.options.map(({ id, send: sent, recommended, input }) => [id, sent, recommended, input]),
      [["new-hire", send("new-hire"), true, undefined]]);
  });

  it("serves Use existing employee with only the independently confirmed matches, and no new hire", () => {
    const other = { emplId: "10000002", name: "Dropped Person" };
    const decision = hireReviewDecision(SearchPersonMatchOutputSchema.parse({ hits: [PERSON, other], confirmed: [PERSON, other], dropped: [{ ...other, reason: "dob" }] }), ARMS, "hire-review", 7);
    assert.deepEqual(decision?.options.map(({ id }) => id), ["existing-person"]);
    const input = decision?.options[0]?.input;
    assert.equal(input?.kind, "candidate");
    assert.deepEqual(input?.kind === "candidate" ? input.table.rows : undefined, [{ id: PERSON.emplId, name: PERSON.name, eid: PERSON.emplId,
      cells: [{ columnId: "name", value: PERSON.name }, { columnId: "eid", value: "••••1234" }] }]);
    assert.equal(input?.kind === "candidate" ? input.table.typed : "absent", undefined, "an existing EID is never typed");
  });

  it("serves no decision when hits exist but none is confirmed", () => {
    assert.equal(hireReviewDecision(SearchPersonMatchOutputSchema.parse({ hits: [PERSON], confirmed: [], dropped: [] }), ARMS, "hire-review", 7), undefined);
  });
});
