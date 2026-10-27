import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, SIGNAL, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("terminal identity binding", () => {
  it("refuses to execute a run bound to a different descriptor identity", async () => {
    const harness = await executorHarness();
    const { database, clock } = harness.authority;
    const run = personLookupQueuedRun();
    const envelope = run.envelope as Record<string, unknown>;
    envelope.contractFingerprint = UUID_6.replaceAll("-", "").padEnd(64, "0");
    database.authority.runs.enqueue(run);
    const { workerId, workerLifetime } = testAdmittedWorker(database, clock, { path: harness.authority.path, workflow: WORKFLOW_ID, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const claimed = database.authority.runs.claimNext({
      workerLifetime, workflow: WORKFLOW_ID,
      workerId: workerId,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    await assert.rejects(
      executeClaimedRun(harness.deps, {
        run: claimed.run,
        claim: { workerId: workerId, claimGeneration: claimed.run.claimGeneration },
        signal: SIGNAL,
      }),
      /the worker is miswired/,
    );
  });
});
