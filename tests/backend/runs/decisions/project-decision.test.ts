import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ActionDescriptorWireSchema } from "../../../../src/models/dashboard/actions.js";
import { RunDecisionTypeSchema, RunDecisionWireSchema } from "../../../../src/models/dashboard/run-decision.js";
import { DECISION_CATALOG } from "../../../../src/backend/runs/decisions/decision-catalog.js";
import { projectDecision } from "../../../../src/backend/runs/decisions/project-decision.js";
import { rowPickDecision } from "../../../../src/backend/runs/workbooks.js";
import { identityGateDecision } from "../../../../src/backend/runs/queries/run-detail/gate-park.js";

const approve = ActionDescriptorWireSchema.parse({ key: "resolve-gate-approved", label: "Approve", intent: "primary", placement: ["review"], kind: "command", command: "resolve-gate", expectedVersion: 3, resolution: "approved" });
const rowAction = approve;
const option = (eid: string) => ({ eid, chosenFrom: "name-search" as const, displayName: `Person ${eid}`, origin: "found by name" });

describe("decision instance text", () => {
  it("declares the dropdown label for every decision that offers more than one choice", () => {
    for (const type of RunDecisionTypeSchema.options) {
      const declaration = DECISION_CATALOG[type];
      const choices = declaration.options.filter(({ id }) => id !== "cancel-run");
      if (choices.length > 1) assert.ok(declaration.choiceLabel, `${type} declares choiceLabel`);
    }
    assert.equal(DECISION_CATALOG["write-parked"].choiceLabel, "Answer");
    assert.equal(DECISION_CATALOG["failed-retryable"].choiceLabel, "Next step");
  });

  it("serves the declared dropdown label and the owner's context line", () => {
    const decision = projectDecision("write-parked", [{ id: "saved", send: { via: "action", actionKey: "recheck-write" }, label: "Saved in UCPath" }, { id: "not-saved", send: { via: "action", actionKey: "resolve-write-absent" }, label: "Not saved, file it again" }],
      { context: "UCPath did not confirm the save." });
    assert.equal(decision.choiceLabel, "Answer");
    assert.equal(decision.context, "UCPath did not confirm the save.");
    assert.equal(projectDecision("write-parked", [{ id: "check-again", send: { via: "action", actionKey: "check-parked-write" } }]).context, undefined);
  });

  it("refuses a decision with several choices and no dropdown label", () => {
    const decision = projectDecision("write-parked", [{ id: "saved", send: { via: "action", actionKey: "recheck-write" }, label: "Saved in UCPath" }, { id: "not-saved", send: { via: "action", actionKey: "resolve-write-absent" }, label: "Not saved, file it again" }]);
    const { choiceLabel: _removed, ...unlabelled } = decision;
    assert.throws(() => RunDecisionWireSchema.parse(unlabelled), /choiceLabel/u);
  });

  it("asks the person pick as a question naming the document's person and counting the candidates", () => {
    const decision = identityGateDecision([option("10000001"), option("10000042")], [approve], [], undefined, { documentName: "Bea Morrow" });
    assert.equal(decision.title, "Which Bea Morrow is this run about?");
    assert.equal(decision.context, "UCPath found 2 people with this name.");
  });

  it("asks the row pick as a question counting the candidate rows", () => {
    const candidates = [{ sheetId: "s", rowId: "r1", label: "Row 12", rowNumber: 12 }, { sheetId: "s", rowId: "r2", label: "Row 65", rowNumber: 65 }];
    const decision = rowPickDecision("workbook-row", "Matching rows", rowAction, candidates);
    assert.equal(decision.title, "Which row should Relay update?");
    assert.equal(decision.context, "2 rows match this person.");
    assert.equal(rowPickDecision("pick-row", "Roster rows", rowAction, candidates).title, "Which row should Relay use?");
  });
});
