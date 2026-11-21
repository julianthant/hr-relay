import { disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
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


describe("run detail HTTP parameters", () => {
  afterEach(disposeHttpRouteHarness);

  it("validates run IDs before reading details and attempt history queries before reading history", async () => {
    const h = await harness();
    const path = `/api/v1/runs/${UUID_5}`;
    const detail = await h.app.request(path);
    assert.equal(detail.status, 404);
    assert.equal(await detail.text(), `{"state":"error","code":"TARGET_NOT_FOUND","message":"run ${UUID_5} is absent from canonical authority","retryable":false}`);
    const history = await h.app.request(`${path}/attempt-history?limit=1`);
    assert.equal(history.status, 200);
    assert.equal(await history.text(), `{"schemaVersion":1,"state":"unavailable","selected":{"state":"absent","disposition":"absent","runId":"${UUID_5}"},"reason":"run-not-found"}`);

    for (const invalid of ["/api/v1/runs/malformed", "/api/v1/runs/malformed/attempt-history",
      `${path}/attempt-history?limit=1&limit=2`, `${path}/attempt-history?limit=1&extra=unused`,
      `${path}/attempt-history?limit=1e0`]) {
      const response = await h.app.request(invalid);
      assert.equal(response.status, 400, invalid);
      assert.equal((await json(response)).code, "SCHEMA_INVALID");
    }
  });
});
