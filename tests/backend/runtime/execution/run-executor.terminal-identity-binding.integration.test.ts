import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKER_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, SIGNAL, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("terminal identity binding", () => {
  it("refuses to execute a run bound to a different descriptor identity", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const run = personLookupQueuedRun();
    const envelope = run.envelope as Record<string, unknown>;
    envelope.contractFingerprint = UUID_6.replaceAll("-", "").padEnd(64, "0");
    database.authority.runs.enqueue(run);
    const claimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    await assert.rejects(
      executeClaimedRun(harness.deps, {
        run: claimed.run,
        claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
        signal: SIGNAL,
      }),
      /the worker is miswired/,
    );
  });
});
