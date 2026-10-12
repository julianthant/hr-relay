import { createFinalizationTerminalTestWorld } from "../../../support/helpers/backend/finalization-terminal-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutionAuthority } from "../../../../src/backend/runtime/execution/run-executor.js";
import { deriveTerminalFailureDigest, RunTerminalEvidenceResultSchema } from "../../../../src/models/run/result.js";
import { FINALIZE_NODE } from "../../../../src/workflows/separations/workflow.js";
import { FINALIZATION_ITEM_ID, FINALIZATION_RUN_ID, type FinalizationHarness } from "../../../support/helpers/kuali-finalization-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";

const {signal, harness, executorDependencies, enqueueFromComparison, parkApproveAndReclaim, cleanup } = createFinalizationTerminalTestWorld();


afterEach(cleanup);

function authorityWithoutFinalizationCheckpoint(
  value: FinalizationHarness,
): RunExecutionAuthority {
  const { authority } = value.database;
  return {
    authority: {
      timelineEvents: authority.timelineEvents,
      runs: authority.runs,
      gateResults: authority.gateResults,
      runResults: authority.runResults,
      artifactOutbox: authority.artifactOutbox,
      runCheckpoints: {
        insert: (input) => authority.runCheckpoints.insert(input),
        get: (workflowId, itemId, nodeId, attempt, claimGeneration) =>
          authority.runCheckpoints.get(
            workflowId,
            itemId,
            nodeId,
            attempt,
            claimGeneration,
          ),
        latest: (workflowId, itemId, nodeId) =>
          nodeId === FINALIZE_NODE
            ? undefined
            : authority.runCheckpoints.latest(workflowId, itemId, nodeId),
        listByAttempt: (workflowId, itemId, nodeId, attempt) =>
          authority.runCheckpoints.listByAttempt(
            workflowId,
            itemId,
            nodeId,
            attempt,
          ),
        listByItem: (workflowId, itemId) =>
          authority.runCheckpoints.listByItem(workflowId, itemId),
      },
    },
    afterAuthorityCommit: (publish) =>
      value.database.afterAuthorityCommit(publish),
  };
}

describe("supplied-EID executor authority", () => {

  it("previews without a gate or any intent, attempt, or outbox write", async () => {
    const value = harness();
    const claimed = enqueueFromComparison(value, true, true);
    const outcome = await value.bound(() =>
      executeClaimedRun(executorDependencies(value), { ...claimed, signal }),
    );
    assert.deepEqual(outcome, { state: "done", runId: FINALIZATION_RUN_ID });
    assert.deepEqual(
      value.database.authority.gateResults.listByRun(FINALIZATION_RUN_ID),
      [],
    );
    assert.deepEqual(
      value.database.authority.writeIntents.listByRun(FINALIZATION_RUN_ID),
      [],
    );
    assert.equal(
      value.emitter.events().some((event) => event.t === "gate.opened"),
      false,
    );
  });
});

describe("current Kuali finalization transaction is terminal evidence", () => {

  it("refuses terminal success when the sequencer's checkpoint is hidden from the executor", async () => {
    const value = harness();
    const claimed = await parkApproveAndReclaim(value);

    const outcome = await value.bound(() =>
      executeClaimedRun(
        executorDependencies(
          value,
          authorityWithoutFinalizationCheckpoint(value),
        ),
        { ...claimed, signal },
      ),
    );

    if (outcome.state !== "failed") {
      throw new Error(
        `checkpoint-removal control returned ${outcome.state}, not failed`,
      );
    }
    const run = value.database.authority.runs.get(FINALIZATION_RUN_ID);
    assert.equal(run?.lifecycle.state, "terminal");
    assert.equal(
      run?.lifecycle.state === "terminal" ? run.lifecycle.outcome : undefined,
      "failed",
    );
    if (
      run?.lifecycle.state !== "terminal" ||
      run.lifecycle.outcome !== "failed"
    ) {
      throw new Error("checkpoint-removal control did not fail the run");
    }
    assert.equal(run.lifecycle.failureId, outcome.failureId);
    const failure = value.database.authority.failures.get(outcome.failureId);
    assert.match(
      failure?.summary ?? "",
      /settled but run .* has no durable checkpoint/u,
    );
    assert.notEqual(
      value.database.authority.runCheckpoints.latest(
        separationsKualiFinalizationDescriptor.id,
        FINALIZATION_ITEM_ID,
        FINALIZE_NODE,
      ),
      undefined,
      "the sequencer wrote the row; only the executor read was mutated",
    );
    const terminal = value.database.authority.runResults.get(FINALIZATION_RUN_ID);
    assert.ok(terminal && failure);
    const retainedFailure = RunTerminalEvidenceResultSchema.parse(terminal.result.value);
    assert.equal(retainedFailure.kind, "failed-evidence");
    if (retainedFailure.kind !== "failed-evidence") throw new Error("terminal failure evidence missing");
    assert.equal(retainedFailure.authorization.failureId, failure.failureId);
    assert.equal(retainedFailure.failureDigest, deriveTerminalFailureDigest(failure));
  });
});
