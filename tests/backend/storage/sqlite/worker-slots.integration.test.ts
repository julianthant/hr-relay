import assert from "node:assert/strict";
import { it } from "vitest";
import { admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerBrowserCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { foundationFixture, id, NOW } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW as NOW_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, RUN_SESSION, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

{

it("keeps canonical claims fenced until the native pool reservation is audited", async () => {
  const fixture = await foundationFixture();
  try {
    const ports = testWorkerPorts(fixture.db, fixture.clock, { path: fixture.path, descriptor: personLookupDescriptor, poolIndex: 2 });
    const worker = fixture.db.authority.workerSlots.list("person-lookup").find(slot => slot.poolIndex === 2);
    assert.ok(worker);
    const runId = id(700);
    fixture.db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...fixture.run.envelope, runId, itemId: runId } });
    const pool = fixture.db.authority.workerPools.get("person-lookup");
    assert.ok(pool);
    const command = WorkerBrowserCommandRequestSchema.parse({ commandId: id(701), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: pool.version }, payload: { desiredWorkers: 2 } });
    assert.equal(command.type, "plan-worker-count");
    if (command.type !== "plan-worker-count") throw new Error("fixture requires pool command");
    fixture.db.withAuthorityTransaction(repositories => {
      repositories.commands.insert(command);
      const roster = admitWorkerPoolRoster(repositories, command, NOW);
      repositories.workerControls.admit({ commandId: command.commandId, request: command, scope: "worker-pool:person-lookup", executorId: id(702),
        admittedAt: NOW, expiresAt: NOW, basisVersion: pool.version, phase: { state: "admitted" }, roster });
    });
    const before = fixture.db.getMeta().authorityGeneration;
    const claim = () => ports.claimNext({ commandId: id(703), workflow: "person-lookup", workerId: worker.workerId });
    assert.deepEqual(claim(), { state: "refused", refusal: { reason: "none-eligible" } });
    assert.equal(fixture.db.authority.runs.get(runId)?.lifecycle.state, "queued");
    assert.equal(fixture.db.getMeta().authorityGeneration, before);
    fixture.db.authority.workerControls.transition(command.commandId, "admitted", { state: "refused", completedAt: NOW, message: "operator declined" });
    assert.deepEqual(claim(), { state: "refused", refusal: { reason: "none-eligible" } });
    fixture.db.authority.workerControls.audit(command.commandId, NOW);
    assert.equal(claim().state, "applied");
    assert.equal(fixture.db.authority.runs.get(runId)?.lifecycle.state, "claimed");
  } finally { await fixture.dispose(); }
});
}

{

const roots: string[] = [];
function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-parallel-runs-authority-"));
  roots.push(root);
  return join(root, "authority.sqlite");
}
function open(path: string): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW_m1)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}
const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};
const OTHER_SESSION_ID = "aaaaaaaa-0009-4000-8000-000900000000";

function queuedRun(
  runId: string,
  overrides: Readonly<{ itemId?: string; traceId?: string; workflow?: string; sessionId?: string }>,
): Record<string, unknown> {
  const { sessionId, ...envelopeOverrides } = overrides;
  return {
    ...QUEUED_RUN,
    envelope: { ...QUEUED_RUN.envelope, runId, ...envelopeOverrides },
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

describe("worker_pools — the CAS basis the spawn control needs (§11.5)", () => {
afterEach(_afterEachFixture0);

  it("refuses a stale expectedVersion by NAME, with the current version — 0 when there is no row", () => {
    const database = open(databasePath());
    const noRow = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 1, desiredWorkers: 1, requestedBy: "local-operator", now: NOW_m1,
    });
    assert.equal(noRow.state, "conflict");
    if (noRow.state !== "conflict") return;
    assert.equal(noRow.currentVersion, 0);
    assert.match(noRow.message, /has no row yet \(version 0\), not version 1/);
    assert.equal(database.authority.workerPools.get(WORKFLOW_ID), undefined);

    database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW_m1,
    });
    const stale = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 3, requestedBy: "local-operator", now: NOW_m1,
    });
    assert.equal(stale.state, "conflict");
    if (stale.state !== "conflict") return;
    assert.equal(stale.currentVersion, 1);
    assert.match(stale.message, /is at version 1, not 0/);
    // Nothing applied over the refusal: the declaration is still the first plan's.
    assert.equal(database.authority.workerPools.get(WORKFLOW_ID)?.desiredWorkers, 1);

    const next = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 1, desiredWorkers: 3, requestedBy: "local-operator", now: NOW_m1,
    });
    assert.equal(next.state, "applied");
    if (next.state !== "applied") return;
    assert.equal(next.pool.version, 2);
    assert.equal(next.pool.desiredWorkers, 3);
  });

  it("keeps each workflow's pool separate and never deletes a row", () => {
    const path = databasePath();
    const database = open(path);
    database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 2, requestedBy: "local-operator", now: NOW_m1,
    });
    database.authority.workerPools.plan({
      workflow: "separations", expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW_m1,
    });
    assert.deepEqual(
      database.authority.workerPools.list().map((pool) => [pool.workflow, pool.desiredWorkers, pool.version]),
      [[WORKFLOW_ID, 2, 1], ["separations", 1, 1]],
    );
    database.close();
    const raw = new DatabaseSync(path);
    assert.throws(() => raw.prepare("DELETE FROM worker_pools").run(), /retained|never deleted/);
    raw.close();
  });
});

describe("run_batches — a durable group whose membership is the run table (§11.1)", () => {
afterEach(_afterEachFixture0);

  it("refuses a member that names a session authority never wrote, or another workflow's session", () => {
    const database = open(databasePath());
    assert.throws(
      () => database.authority.runs.enqueue(queuedRun(RUN_ID, { sessionId: OTHER_SESSION_ID })),
      /names session aaaaaaaa-0009-4000-8000-000900000000, which authority never wrote/,
    );
    assert.equal(database.authority.runs.get(RUN_ID), undefined);

    database.authority.runSessions.insert({ ...RUN_SESSION, sessionId: OTHER_SESSION_ID, workflow: "separations" });
    assert.throws(
      () => database.authority.runs.enqueue(queuedRun(RUN_ID, { sessionId: OTHER_SESSION_ID })),
      /which groups separations; a session groups runs of one workflow/,
    );
  });

  it("reads an admitted current ungrouped run as no session", () => {
    const path = databasePath();
    const database = open(path);
    database.authority.runs.enqueue(queuedRun(RUN_ID, {}));
    database.close();
    const raw = new DatabaseSync(path);
    const row = raw.prepare("SELECT batch_id AS session_id FROM runs WHERE id = ?").get(RUN_ID) as { session_id: string | null };
    assert.equal(row.session_id, null);
    raw.close();
    const reopened = open(path);
    const record = reopened.authority.runs.get(RUN_ID);
    assert.ok(record !== undefined);
    assert.equal(record.sessionId, undefined);
    assert.equal("sessionId" in record, false);
    reopened.close();
  });
});
}
