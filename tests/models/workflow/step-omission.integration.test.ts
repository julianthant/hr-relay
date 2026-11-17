import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";






import { planStepOmissions } from "../../../src/models/workflow/step-omission.js";





import { stepOmissionCascade } from "../../../src/models/workflow/step-omission.js";
import type { StepOmissionGraphView } from "../../../src/models/workflow/step-omission.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

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

describe("separations omittable steps", () => {

  it("forces no other step out and blocks on none", () => {
    const rows = stepOmissionCascade(graphView());
    assert.deepEqual([...rows.entries()], [
      ["kronos-timecard", { state: "omittable", forces: [] }],
    ]);
  });

  it("classifies each omission over the real graph: browser reads omitted, folds asserted", () => {
    const view = graphView();
    const kronos = planStepOmissions(view, [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" } }]);
    assert.deepEqual(kronos.refusals, []);
    assert.deepEqual([...kronos.omitted.keys()], ["timecard-search", "timecard"]);
    assert.deepEqual([...kronos.asserted.keys()], ["dates"]);

    const identity = planStepOmissions(view, [{ step: "identity-check", facts: {} }]);
    assert.deepEqual(identity.refusals.map(({ code }) => code), ["step-not-omittable"]);

  });
});
}
