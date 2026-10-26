
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { workerPoolVersion } from "../../../src/models/run/worker-pool.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT,NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { openBoundDatabaseFixture } from "../../support/helpers/admission-fixture.js";

const closers: (() => void)[] = [];
function open(): ReturnType<typeof openBoundDatabaseFixture>["database"] {
  const opened = openBoundDatabaseFixture("unit-test", manualClock(new Date(NOW)));
  closers.push(() => opened.close());
  if (opened.database.authority.runtimeConfig.get() === undefined) opened.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return opened.database;
}
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("worker_pools — the CAS basis the spawn control needs (§11.5)", () => {
  it("reads a workflow with no row as version 0, and the first plan creates the row at version 1", () => {
    const database = open();
    assert.equal(database.authority.workerPools.get(WORKFLOW_ID), undefined);
    assert.equal(workerPoolVersion(database.authority.workerPools.get(WORKFLOW_ID)), 0);

    const planned = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW,
    });
    assert.equal(planned.state, "applied");
    if (planned.state !== "applied") return;
    assert.equal(planned.pool.version, 1);
    assert.equal(planned.pool.desiredWorkers, 1);
    assert.equal(planned.pool.plannedBy, "local-operator");
    assert.deepEqual(database.authority.workerPools.list().map((pool) => pool.workflow), [WORKFLOW_ID]);
  });
});
