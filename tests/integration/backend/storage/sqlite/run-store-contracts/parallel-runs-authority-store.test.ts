
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { workerPoolVersion } from "../../../../../../src/models/run/worker-pool.js";
import { runSessionActorId, RunSessionRecordSchema } from "../../../../../../src/models/run/session.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { CONFIG_SNAPSHOT, NOW, UUID_6, UUID_8 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, RUN_SESSION, RUN_SESSION_ID, WORKFLOW_ID } from "../../../../../support/fixtures/phase1f-run-fixtures.js";

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

const RUN_ID_2 = "aaaaaaaa-0002-4000-8000-000200000000";
const RUN_ID_3 = "aaaaaaaa-0003-4000-8000-000300000000";
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

  it("refuses a stale expectedVersion by NAME, with the current version — 0 when there is no row", () => {
    const database = open(databasePath());
    const noRow = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 1, desiredWorkers: 1, requestedBy: "local-operator", now: NOW,
    });
    assert.equal(noRow.state, "conflict");
    if (noRow.state !== "conflict") return;
    assert.equal(noRow.currentVersion, 0);
    assert.match(noRow.message, /has no row yet \(version 0\), not version 1/);
    assert.equal(database.authority.workerPools.get(WORKFLOW_ID), undefined);

    database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW,
    });
    const stale = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 3, requestedBy: "local-operator", now: NOW,
    });
    assert.equal(stale.state, "conflict");
    if (stale.state !== "conflict") return;
    assert.equal(stale.currentVersion, 1);
    assert.match(stale.message, /is at version 1, not 0/);
    // Nothing applied over the refusal: the declaration is still the first plan's.
    assert.equal(database.authority.workerPools.get(WORKFLOW_ID)?.desiredWorkers, 1);

    const next = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID, expectedVersion: 1, desiredWorkers: 3, requestedBy: "local-operator", now: NOW,
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
      workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 2, requestedBy: "local-operator", now: NOW,
    });
    database.authority.workerPools.plan({
      workflow: "separations", expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW,
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
  it("inserts immutably, and reads the actor off the origin", () => {
    const path = databasePath();
    const database = open(path);
    const first = database.authority.runSessions.insert(RUN_SESSION);
    assert.equal(first.state, "inserted");
    assert.equal(database.authority.runSessions.insert(RUN_SESSION).state, "existing");
    assert.throws(
      () => database.authority.runSessions.insert({ ...RUN_SESSION, startedAt: "2026-07-31T17:00:01.000Z", createdAt: "2026-07-31T17:00:01.000Z" }),
      /already exists with different content/,
    );
    const stored = database.authority.runSessions.get(RUN_SESSION_ID);
    assert.ok(stored !== undefined);
    assert.equal(runSessionActorId(stored), "local-operator");
    assert.deepEqual(database.authority.runSessions.listByWorkflow(WORKFLOW_ID).map((s) => s.sessionId), [RUN_SESSION_ID]);
    database.close();

    const raw = new DatabaseSync(path);
    assert.throws(() => raw.prepare("UPDATE run_batches SET workflow = 'x'").run(), /run-batches-presentation/);
    assert.throws(() => raw.prepare("DELETE FROM run_batches").run(), /retained|never deleted/);
    raw.close();
  });

  it("stores NO member list: membership is the run rows that carry the id, and it survives a reopen", () => {
    const path = databasePath();
    const database = open(path);
    database.authority.runSessions.insert(RUN_SESSION);
    database.authority.runs.enqueue(queuedRun(RUN_ID, { sessionId: RUN_SESSION_ID }));
    database.authority.runs.enqueue(queuedRun(RUN_ID_2, { itemId: UUID_6, traceId: "pl-170002-0002", sessionId: RUN_SESSION_ID }));
    // A run no fan-out grouped — the pre-v17 shape — is not a member of anything.
    database.authority.runs.enqueue(queuedRun(RUN_ID_3, { itemId: UUID_8, traceId: "pl-170003-0003" }));

    assert.deepEqual(database.authority.runs.listBySession(RUN_SESSION_ID).map((run) => run.envelope.runId), [RUN_ID, RUN_ID_2]);
    assert.equal(database.authority.runs.get(RUN_ID)?.sessionId, RUN_SESSION_ID);
    assert.equal(database.authority.runs.get(RUN_ID_3)?.sessionId, undefined);
    // The session record itself names no members — the schema has no such field.
    assert.equal("members" in RunSessionRecordSchema.shape, false);
    database.close();

    const reopened = open(path);
    assert.deepEqual(reopened.authority.runs.listBySession(RUN_SESSION_ID).map((run) => run.envelope.runId), [RUN_ID, RUN_ID_2]);
    assert.equal(reopened.authority.runSessions.get(RUN_SESSION_ID)?.workflow, WORKFLOW_ID);
    reopened.close();
  });

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
