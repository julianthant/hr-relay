import { createRunExecutorTestWorld } from "../../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { UUID_5} from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase as SyntheticAuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";

const {executorHarness, actionBindingCompiled, actionBindingQueuedRun, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("recorded operation display data", () => {


  it("keeps a recorded operation display snapshot as plain data across close and reopen", async () => {
    const harness = await executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const { database, clock, path } = harness.authority;
    const plain = actionBindingQueuedRun(clock.now().toISOString());
    const snapshot = { contentDigest: "0".repeat(64), invocations: [] };
    const queued = { ...plain, envelope: { ...plain.envelope, operationDisplayCapability: "complete" as const, operationDisplaySnapshot: snapshot } };
    database.authority.runs.enqueue(queued);
    const authorityGeneration = database.getMeta().authorityGeneration;
    harness.authority.closeDatabase();

    const reopened = SyntheticAuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "operation-display-snapshot-reopen-test" },
      clock,
    );
    try {
      const stored = reopened.authority.runs.get(UUID_5);
      assert.ok(stored);
      assert.deepEqual(stored.envelope.operationDisplaySnapshot, snapshot);
      assert.equal(reopened.getMeta().authorityGeneration, authorityGeneration);
    } finally {
      reopened.close();
    }
  });

});
