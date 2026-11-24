import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
adjacentRunStartStage,
reconcileRunStartStage,
runStartStages,
} from "../../../../src/dashboard/surfaces/run-start/run-start-timeline.js";

describe("run-start timeline", () => {
  it("is two steps, Input then Start, for every run", () => {
    const stages = runStartStages();
    assert.deepEqual(stages, [
      { label: "Input", number: 1 },
      { label: "Start", number: 2 },
    ]);
    assert.equal(adjacentRunStartStage(stages, "Input", "next"), "Start");
    assert.equal(adjacentRunStartStage(stages, "Start", "next"), null);
    assert.equal(adjacentRunStartStage(stages, "Input", "previous"), null);
    assert.equal(adjacentRunStartStage(stages, "Start", "previous"), "Input");
  });

  it("keeps a stage on the path and falls back to Input for one that is not", () => {
    const stages = runStartStages();
    assert.equal(reconcileRunStartStage(stages, "Start", false), "Start");
    assert.equal(reconcileRunStartStage(stages, "Input", false), "Input");
    assert.equal(reconcileRunStartStage(stages, "Warning", true), "Warning");
    assert.equal(reconcileRunStartStage(stages, "Warning", false), "Input");
  });
});
