import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
adjacentRunStartStage,
reconcileRunStartStage,
runStartStages,
} from "../../../../src/dashboard/surfaces/run-start/run-start-timeline.js";

describe("run-start timeline", () => {
  it("is two steps: Input then Start for a run, Steps then Start for a rerun", () => {
    assert.deepEqual(runStartStages(true), [{ label: "Steps", number: 1 }, { label: "Start", number: 2 }]);
    const stages = runStartStages(false);
    assert.deepEqual(stages, [
      { label: "Input", number: 1 },
      { label: "Start", number: 2 },
    ]);
    assert.equal(adjacentRunStartStage(stages, "Input", "next"), "Start");
    assert.equal(adjacentRunStartStage(stages, "Start", "next"), null);
    assert.equal(adjacentRunStartStage(stages, "Input", "previous"), null);
    assert.equal(adjacentRunStartStage(stages, "Start", "previous"), "Input");
  });

  it("keeps a stage on the path and falls back to the first page for one that is not", () => {
    for (const [rerun, first, missing] of [[false, "Input", "Steps"], [true, "Steps", "Input"]] as const) {
      const stages = runStartStages(rerun);
      assert.equal(reconcileRunStartStage(stages, "Start"), "Start");
      assert.equal(reconcileRunStartStage(stages, first), first);
      assert.equal(reconcileRunStartStage(stages, missing), first);
    }
  });
});
