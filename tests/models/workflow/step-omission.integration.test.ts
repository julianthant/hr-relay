import { createOmissionDefinitionFixtures } from "../../support/helpers/workflow/omission-definition-fixtures.js";
import { default as assert } from "node:assert/strict";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";

import { stepOmissionGraphView } from "../../../src/backend/runs/start/step-selection.js";





import { planStepOmissions } from "../../../src/models/workflow/step-omission.js";





import { compileFixtureWorkflow } from "../../support/fixtures/workflow-definition-fixtures.js";
import { stepOmissionCascade } from "../../../src/models/workflow/step-omission.js";
import type { StepOmissionGraphView } from "../../../src/models/workflow/step-omission.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

{

const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const { gateInsideOmittableStep } = createOmissionDefinitionFixtures();

describe("definition-time omission completeness", () => {
afterEach(_afterEachFixture0);

  it("admits the terminal result as the one reader of an omitted member and compiles the gate-inside-step shape", () => {
    const compiled = compileFixtureWorkflow(gateInsideOmittableStep);
    const plan = planStepOmissions(
      stepOmissionGraphView(compiled.descriptor),
      [{ step: "deciding", facts: { verifiedByHand: true } }],
    );
    assert.deepEqual(plan.refusals, []);
    assert.deepEqual([...plan.omitted.entries()], [["review", "deciding"]]);
    assert.deepEqual([...plan.asserted.keys()], ["verify"]);
  });
});
}

{

function graphView(): StepOmissionGraphView {
  return {
    nodes: descriptorRuntimeNodes(separationsDescriptor).map((node) => ({
      id: String(node.id), kind: node.kind, dependsOn: node.dependsOn.map(String),
    })),
    timeline: separationsDescriptor.timeline,
    stepOmissions: separationsDescriptor.stepOmissions,
  };
}

describe("separations omittable write steps", () => {

  it("forces no other step out and blocks on none", () => {
    const rows = stepOmissionCascade(graphView());
    assert.deepEqual([...rows.entries()], [
      ["kronos-timecard", { state: "omittable", forces: [] }],
      ["ucpath-transaction", { state: "omittable", forces: [] }],
      ["kuali-finalization", { state: "omittable", forces: [] }],
    ]);
  });

  it("classifies each omission over the real graph: browser reads and transactions omitted, folds asserted", () => {
    const view = graphView();
    const kronos = planStepOmissions(view, [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } }]);
    assert.deepEqual(kronos.refusals, []);
    assert.deepEqual([...kronos.omitted.keys()], ["timecard-search", "timecard"]);
    assert.deepEqual([...kronos.asserted.keys()], ["dates"]);

    const ucpath = planStepOmissions(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } }]);
    assert.deepEqual(ucpath.refusals, []);
    assert.deepEqual([...ucpath.omitted.keys()], ["pending-set", "clear-pending", "file-termination"]);
    assert.deepEqual([...ucpath.asserted.keys()], ["receipt"]);

    const finalization = planStepOmissions(view, [{ step: "kuali-finalization", facts: {} }]);
    assert.deepEqual(finalization.refusals, []);
    assert.deepEqual([...finalization.omitted.keys()], ["filing-presence", "finalize-kuali"]);
    assert.equal(finalization.asserted.size, 0);

    const all = planStepOmissions(view, [
      { step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } },
      { step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Approved" } },
      { step: "kuali-finalization", facts: {} },
    ]);
    assert.deepEqual(all.refusals, []);

    const identity = planStepOmissions(view, [{ step: "identity-check", facts: {} }]);
    assert.deepEqual(identity.refusals.map(({ code }) => code), ["step-not-omittable"]);

    const denied = planStepOmissions(view, [{ step: "ucpath-transaction", facts: { transactionNumber: "T002204014", approvalStatus: "Denied" } }]);
    assert.deepEqual(denied.refusals.map(({ code }) => code), ["facts-invalid"]);
  });
});
}
