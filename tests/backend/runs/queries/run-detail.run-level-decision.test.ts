import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { queueRowActions } from "../../../../src/backend/runs/projections/queue-row-actions.js";
import { runLevelDecision } from "../../../../src/backend/runs/queries/run-detail.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";

const facts = { rowRevision: 4, dryRun: true, isChild: false, parkedWrite: false, isMember: false, named: false, hasReviewPanel: false } as const;

describe("runLevelDecision", () => {
  it("serves nothing for a run with no run-level decision", () => {
    assert.equal(runLevelDecision({ status: "running", paused: false, stalled: false }), undefined);
  });

  it("serves a cancelling run as a line with no options", () => {
    assert.deepEqual(runLevelDecision({ status: "cancelling", paused: false, stalled: false })?.options, []);
  });

  it("binds Resume and Cancel to the queue row's own descriptors, including a group's cancel-tree", () => {
    const rowActions = queueRowActions(STANDARD_WORKFLOW_ACTIONS, { ...facts, status: "blocked", memberCount: 2,
      pauseControl: { state: "paused", command: "resume", expectedVersion: PositiveIntSchema.parse(4) } });
    const decision = runLevelDecision({ status: "blocked", paused: true, stalled: false, rowActions });
    assert.equal(decision?.type, "paused");
    assert.deepEqual(decision?.options.map(({ id, label, send }) => [id, label, send]), [
      ["resume", "Resume", { via: "row-action", actionKey: "resume" }],
      ["cancel-run", "Cancel group", { via: "row-action", actionKey: "cancel-tree" }],
    ]);
    assert.equal(decision?.options[1]?.confirm?.title, "Cancel this group");
  });

  it("serves a member's retry before any other run-level state", () => {
    assert.equal(runLevelDecision({ status: "cancelling", childRetryKey: "retry-child", paused: false, stalled: false })?.type, "member-failed");
  });
});
