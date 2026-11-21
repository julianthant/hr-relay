import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import type { ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";

const { SCENARIO, providersOnlyContract, fixtureDescriptor, queuedRunFor, wiringHarness, claim, cleanup } = createCapabilityWiringTestWorld();
afterEach(cleanup);

describe("task setup that throws before the task runs", () => {
  it("reports the setup failure and releases the task deadline and the parent abort listener", async () => {
    const task = defineTask(providersOnlyContract, {
      sessions: [],
      async run() { throw new Error("the task must not run after its setup failed"); },
    });
    const descriptor = fixtureDescriptor("task-setup-cleanup", "tc", providersOnlyContract);
    const stores = defineTaskStoreRegistry([defineServiceStore("ocr", { fixture: task })], {
      scenarioIds: [SCENARIO],
      tasks: [{ id: task.contract.id, effect: task.contract.effect }],
    });
    const { authority, deps } = await wiringHarness(descriptor, stores, {
      // A stored snapshot that cannot configure the provider client makes client construction throw.
      providers: { adapters: {} as never, configSnapshots: { get: () => ({}) }, idFactory: { next: () => "r" } as never },
    });
    authority.database.authority.runs.enqueue(queuedRunFor(descriptor));
    const claimed = claim(authority, descriptor);

    const parent = new AbortController();
    let added = 0;
    let removed = 0;
    const { addEventListener, removeEventListener } = parent.signal;
    parent.signal.addEventListener = (...args: Parameters<typeof addEventListener>) => { if (args[0] === "abort") added += 1; addEventListener.apply(parent.signal, args); };
    parent.signal.removeEventListener = (...args: Parameters<typeof removeEventListener>) => { if (args[0] === "abort") removed += 1; removeEventListener.apply(parent.signal, args); };

    const outcome = await executeClaimedRun(deps, { ...claimed, signal: parent.signal });

    assert.equal(outcome.state, "failed");
    const failures = authority.database.authority.failures.listByRun(RUN_ID);
    assert.equal(failures[0]?.nodeId, "extract", "the setup failure is recorded against the step");
    assert.doesNotMatch(failures[0]?.summary ?? "", /must not run|wires no/u);
    assert.ok(added > 0, "the task installed a parent abort listener");
    assert.equal(removed, added, "every parent abort listener is removed");
    assert.deepEqual((deps.scheduler as ManualScheduler).pending(), [], "the task deadline is cancelled");
  });
});
