import assert from "node:assert/strict";
import { it } from "vitest";
import { fixedLayoutAdmits, fixedLayoutTransition, fixedLayoutUnfinished, type FixedLayoutJournalState, type FixedLayoutPhase } from "../../../../src/backend/storage/maintenance/fixed-layout.js";

it("fixed layout: a publication rewrites its phase unchanged or advances one step, and nothing moves back or skips", () => {
  const phases: readonly FixedLayoutPhase[] = ["moving", "configuring", "complete"];
  const expected: Record<FixedLayoutJournalState, Record<FixedLayoutPhase, string>> = {
    absent: { moving: "advance", configuring: "refused", complete: "refused" },
    moving: { moving: "unchanged", configuring: "advance", complete: "refused" },
    configuring: { moving: "refused", configuring: "unchanged", complete: "advance" },
    complete: { moving: "refused", configuring: "refused", complete: "unchanged" },
  };
  for (const [from, row] of Object.entries(expected) as [FixedLayoutJournalState, Record<FixedLayoutPhase, string>][]) {
    for (const to of phases) assert.equal(fixedLayoutTransition(from, to), row[to], `${from} -> ${to}`);
  }
});

it("fixed layout: installation admission refuses an unfinished layout, except configuring under stopped-control-forward", () => {
  const expected: Record<FixedLayoutJournalState, readonly [boolean, boolean]> = {
    absent: [true, true], moving: [false, false], configuring: [false, true], complete: [true, true],
  };
  for (const [state, [ordinary, stoppedForward]] of Object.entries(expected) as [FixedLayoutJournalState, readonly [boolean, boolean]][]) {
    assert.equal(fixedLayoutAdmits(state, false), ordinary, `${state} ordinary`);
    assert.equal(fixedLayoutAdmits(state, true), stoppedForward, `${state} stopped-control-forward`);
  }
  assert.deepEqual((["absent", "moving", "configuring", "complete"] as const).filter(fixedLayoutUnfinished), ["moving", "configuring"]);
});
