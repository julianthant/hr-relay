import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { UUID_5, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const {executorHarness, enqueueAndClaim, SIGNAL, ACTION_BINDING_WORKFLOW_ID, actionBindingCompiled, actionBindingQueuedRun, actionBindingSessions, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("complete operation display action binding", () => {

  for (const refusal of [
    {
      name: "unmapped target",
      sessions: actionBindingSessions({ typedTarget: "ucpath.person-org.unmapped-eid-input" }),
      expected: /is not declared/u,
    },
    {
      name: "mismatched field value",
      sessions: actionBindingSessions({ typedValue: "10870000" }),
      expected: /does not match declared field path emplId/u,
    },
    {
      name: "unmapped page open",
      sessions: actionBindingSessions({ openedTarget: "ucpath.person-org.unmapped-screen" }),
      expected: /browser action opened ucpath\.person-org\.unmapped-screen is not declared/u,
    },
  ]) {
    it(`refuses ${refusal.name} even when no note sink is configured`, async () => {
      const harness = await executorHarness({ sessions: refusal.sessions, descriptor: actionBindingCompiled.descriptor });
      const { database, clock } = harness.authority;
      const claimed = enqueueAndClaim(
        database,
        actionBindingQueuedRun(clock.now().toISOString(), { protectedValue: false }),
        clock.now().toISOString(),
        ACTION_BINDING_WORKFLOW_ID,
      );

      const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
      assert.equal(outcome.state, "failed");
      const failure = database.authority.failures.listByRun(UUID_5)[0];
      assert.ok(failure);
      assert.match(failure.summary, refusal.expected);
      assert.equal(database.authority.runCheckpoints.latest(ACTION_BINDING_WORKFLOW_ID, UUID_6, "search"), undefined);
    });
  }

  it("rejects a complete snapshot paired with a legacy descriptor before opening a driver", async () => {
    const { operationDisplay: _operationDisplay, ...legacyDescriptor } = actionBindingCompiled.descriptor;
    const harness = await executorHarness({ descriptor: legacyDescriptor });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    await assert.rejects(
      () => executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL }),
      /legacy run fixture-operation-action-binding cannot carry a complete operation display snapshot/u,
    );
    assert.equal(harness.sessions.opens(), 0);
  });
});
