
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { workerPoolVersion } from "../../../src/models/run/worker-pool.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT,NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-parallel-runs-authority-"));
  roots.push(root);
  return join(root, "authority.sqlite");
}
function open(path: string): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("worker_pools — the CAS basis the spawn control needs (§11.5)", () => {
  it("reads a workflow with no row as version 0, and the first plan creates the row at version 1", () => {
    const database = open(databasePath());
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
