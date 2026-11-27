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

describe("separations: every step can be switched off", () => {
  const KRONOS = { lastDayWorked: "06/18/2026", separationDate: "06/18/2026" };
  const KUALI = { employeeName: "Quillan, Petra A.", lastDayWorked: "06/18/2026", separationDate: "06/18/2026", terminationType: "Graduated/No longer a Student" };
  const IDENTITY = { emplId: "10873698", emplRecord: "0", department: "000123 - Synthetic Department", payrollTitleCode: "004923", payrollTitle: "STDT 2" };
  const REVIEW = { emplId: "10873698", ucpathName: "Quillan, Petra A." };
  const RECEIPT = { transactionNumber: "T002204014", approvalStatus: "Approved", effectiveDate: "06/20/2026" };

  it("forces only the steps that read a skipped page, and blocks on none", () => {
    const rows = stepOmissionCascade(graphView());
    assert.deepEqual([...rows.entries()], [
      ["kuali-extraction", { state: "omittable", forces: ["identity-check", "identity-review", "kuali-finalization"] }],
      ["identity-check", { state: "omittable", forces: ["identity-review"] }],
      ["kronos-timecard", { state: "omittable", forces: [] }],
      ["identity-review", { state: "omittable", forces: [] }],
      ["pending-termination", { state: "omittable", forces: [] }],
      ["ucpath-transaction", { state: "omittable", forces: [] }],
      ["kuali-finalization", { state: "omittable", forces: [] }],
    ]);
  });

  it("classifies each omission over the real graph: reads, gates and writes omitted, folds asserted", () => {
    const view = graphView();
    const plan = (step: string, facts: Parameters<typeof planStepOmissions>[1][number]["facts"]) => planStepOmissions(view, [{ step, facts }]);
    const kronos = plan("kronos-timecard", KRONOS);
    assert.deepEqual(kronos.refusals, []);
    assert.deepEqual([...kronos.omitted.keys()], ["timecard-search", "timecard"]);
    assert.deepEqual([...kronos.asserted.keys()], ["dates"]);

    const review = plan("identity-review", REVIEW);
    assert.deepEqual(review.refusals, []);
    assert.deepEqual([...review.omitted.keys()], ["comparison", "identity-approval"]);
    assert.deepEqual([...review.asserted.keys()], ["approval"]);

    const pending = plan("pending-termination", {});
    assert.deepEqual(pending.refusals, [], "the termination only waits on the sweep; a sweep done by hand frees it");
    assert.deepEqual([...pending.omitted.keys()], ["pending-set", "clear-pending"]);

    const ucpath = plan("ucpath-transaction", RECEIPT);
    assert.deepEqual(ucpath.refusals, []);
    assert.deepEqual([...ucpath.omitted.keys()], ["file-termination"]);
    assert.deepEqual([...ucpath.asserted.keys()], ["receipt"]);

    const finalization = plan("kuali-finalization", {});
    assert.deepEqual(finalization.refusals, []);
    assert.deepEqual([...finalization.omitted.keys()], ["filing-presence", "finalize-kuali"]);

    assert.deepEqual([...new Set(plan("identity-check", IDENTITY).refusals.map(({ step }) => step))], ["identity-review"],
      "the comparison reads the skipped UCPath search, so Approve identity goes off with it");
    assert.deepEqual([...new Set(plan("kuali-extraction", KUALI).refusals.map(({ step }) => step))], ["identity-check", "identity-review", "kuali-finalization"]);

    const all = planStepOmissions(view, [
      { step: "kuali-extraction", facts: KUALI }, { step: "identity-check", facts: IDENTITY }, { step: "kronos-timecard", facts: KRONOS },
      { step: "identity-review", facts: REVIEW }, { step: "pending-termination", facts: {} }, { step: "ucpath-transaction", facts: RECEIPT },
      { step: "kuali-finalization", facts: {} },
    ]);
    assert.deepEqual(all.refusals, []);

    assert.deepEqual(plan("ucpath-transaction", { ...RECEIPT, approvalStatus: "Denied" }).refusals.map(({ code }) => code), ["facts-invalid"]);
  });
});
}
