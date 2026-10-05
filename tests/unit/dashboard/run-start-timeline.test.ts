import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  adjacentRunStartStage,
  reconcileRunStartStage,
  runStartStages,
} from "../../../src/dashboard/surfaces/run-start/run-start-timeline.js";

describe("run-start timeline", () => {
  it("keeps Options in the ordinary path", () => {
    assert.deepEqual(runStartStages(false), [
      { label: "Input", number: 1 },
      { label: "Options", number: 2 },
      { label: "Confirm", number: 3 },
    ]);
  });

  it("adds Steps after Options when customization is enabled", () => {
    const stages = runStartStages(true);
    assert.deepEqual(stages, [
      { label: "Input", number: 1 },
      { label: "Options", number: 2 },
      { label: "Steps", number: 3 },
      { label: "Confirm", number: 4 },
    ]);
    assert.equal(adjacentRunStartStage(stages, "Input", "next"), "Options");
    assert.equal(adjacentRunStartStage(stages, "Options", "next"), "Steps");
    assert.equal(adjacentRunStartStage(stages, "Input", "previous"), null);
  });

  it("returns to Options when Steps disappears", () => {
    assert.equal(reconcileRunStartStage(runStartStages(false), "Steps"), "Options");
  });
});
