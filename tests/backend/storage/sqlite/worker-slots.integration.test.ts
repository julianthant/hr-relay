import assert_m0 from "node:assert/strict";
import { it as it_m0 } from "vitest";
import { admitWorkerPoolRoster as admitWorkerPoolRoster_m0 } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerBrowserCommandRequestSchema as WorkerBrowserCommandRequestSchema_m0 } from "../../../../src/rules/commands/commands.js";
import { QUEUED_RUN as QUEUED_RUN_m0 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts as testWorkerPorts_m0 } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { foundationFixture as foundationFixture_m0,id as id_m0,NOW as NOW_m0 } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor as personLookupDescriptor_m0 } from "../../../support/helpers/registered-workflows.js";

import assert_m1 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m1,rmSync as rmSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m1,NOW as NOW_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m1,RUN_ID as RUN_ID_m1,RUN_SESSION as RUN_SESSION_m1,WORKFLOW_ID as WORKFLOW_ID_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase as AuthorityDatabase_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


it_m0("keeps canonical claims fenced until the native pool reservation is audited", () => {
  const fixture = foundationFixture_m0();
  try {
    const ports = testWorkerPorts_m0(fixture.db, fixture.clock, { path: fixture.path, descriptor: personLookupDescriptor_m0, poolIndex: 2 });
    const worker = fixture.db.authority.workerSlots.list("person-lookup").find(slot => slot.poolIndex === 2);
    assert_m0.ok(worker);
    const runId = id_m0(700);
    fixture.db.authority.runs.enqueue({ ...QUEUED_RUN_m0, envelope: { ...fixture.run.envelope, runId, itemId: runId } });
    const pool = fixture.db.authority.workerPools.get("person-lookup");
    assert_m0.ok(pool);
    const command = WorkerBrowserCommandRequestSchema_m0.parse({ commandId: id_m0(701), requestedAt: NOW_m0, requestedBy: "local-operator", source: "dashboard",
      family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: pool.version }, payload: { desiredWorkers: 2 } });
    assert_m0.equal(command.type, "plan-worker-count");
    if (command.type !== "plan-worker-count") throw new Error("fixture requires pool command");
    fixture.db.withAuthorityTransaction(repositories => {
      repositories.commands.insert(command);
      const roster = admitWorkerPoolRoster_m0(repositories, command, NOW_m0);
      repositories.workerControls.admit({ commandId: command.commandId, request: command, scope: "worker-pool:person-lookup", executorId: id_m0(702),
        admittedAt: NOW_m0, expiresAt: NOW_m0, basisVersion: pool.version, phase: { state: "admitted" }, roster });
    });
    const before = fixture.db.getMeta().authorityGeneration;
    const claim = () => ports.claimNext({ commandId: id_m0(703), workflow: "person-lookup", workerId: worker.workerId });
    assert_m0.deepEqual(claim(), { state: "refused", refusal: { reason: "none-eligible" } });
    assert_m0.equal(fixture.db.authority.runs.get(runId)?.lifecycle.state, "queued");
    assert_m0.equal(fixture.db.getMeta().authorityGeneration, before);
    fixture.db.authority.workerControls.transition(command.commandId, "admitted", { state: "refused", completedAt: NOW_m0, message: "operator declined" });
    assert_m0.deepEqual(claim(), { state: "refused", refusal: { reason: "none-eligible" } });
    fixture.db.authority.workerControls.audit(command.commandId, NOW_m0);
    assert_m0.equal(claim().state, "applied");
    assert_m0.equal(fixture.db.authority.runs.get(runId)?.lifecycle.state, "claimed");
  } finally { fixture.dispose(); }
});
}

{


const roots: string[] = [];
function databasePath(): string {
  const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-parallel-runs-authority-"));
  roots.push(root);
  return join_m1(root, "authority.sqlite");
}
function open(path: string): AuthorityDatabase_m1 {
  const database = AuthorityDatabase_m1.open(
    { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock_m1(new Date(NOW_m1)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m1);
  return database;
}
const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true });
};
const OTHER_SESSION_ID = "aaaaaaaa-0009-4000-8000-000900000000";

function queuedRun(
  runId: string,
  overrides: Readonly<{ itemId?: string; traceId?: string; workflow?: string; sessionId?: string }>,
): Record<string, unknown> {
  const { sessionId, ...envelopeOverrides } = overrides;
  return {
    ...QUEUED_RUN_m1,
    envelope: { ...QUEUED_RUN_m1.envelope, runId, ...envelopeOverrides },
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

describe_m1("worker_pools — the CAS basis the spawn control needs (§11.5)", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("refuses a stale expectedVersion by NAME, with the current version — 0 when there is no row", () => {
    const database = open(databasePath());
    const noRow = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID_m1, expectedVersion: 1, desiredWorkers: 1, requestedBy: "local-operator", now: NOW_m1,
    });
    assert_m1.equal(noRow.state, "conflict");
    if (noRow.state !== "conflict") return;
    assert_m1.equal(noRow.currentVersion, 0);
    assert_m1.match(noRow.message, /has no row yet \(version 0\), not version 1/);
    assert_m1.equal(database.authority.workerPools.get(WORKFLOW_ID_m1), undefined);

    database.authority.workerPools.plan({
      workflow: WORKFLOW_ID_m1, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW_m1,
    });
    const stale = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID_m1, expectedVersion: 0, desiredWorkers: 3, requestedBy: "local-operator", now: NOW_m1,
    });
    assert_m1.equal(stale.state, "conflict");
    if (stale.state !== "conflict") return;
    assert_m1.equal(stale.currentVersion, 1);
    assert_m1.match(stale.message, /is at version 1, not 0/);
    // Nothing applied over the refusal: the declaration is still the first plan's.
    assert_m1.equal(database.authority.workerPools.get(WORKFLOW_ID_m1)?.desiredWorkers, 1);

    const next = database.authority.workerPools.plan({
      workflow: WORKFLOW_ID_m1, expectedVersion: 1, desiredWorkers: 3, requestedBy: "local-operator", now: NOW_m1,
    });
    assert_m1.equal(next.state, "applied");
    if (next.state !== "applied") return;
    assert_m1.equal(next.pool.version, 2);
    assert_m1.equal(next.pool.desiredWorkers, 3);
  });

  it_m1("keeps each workflow's pool separate and never deletes a row", () => {
    const path = databasePath();
    const database = open(path);
    database.authority.workerPools.plan({
      workflow: WORKFLOW_ID_m1, expectedVersion: 0, desiredWorkers: 2, requestedBy: "local-operator", now: NOW_m1,
    });
    database.authority.workerPools.plan({
      workflow: "separations", expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW_m1,
    });
    assert_m1.deepEqual(
      database.authority.workerPools.list().map((pool) => [pool.workflow, pool.desiredWorkers, pool.version]),
      [[WORKFLOW_ID_m1, 2, 1], ["separations", 1, 1]],
    );
    database.close();
    const raw = new DatabaseSync_m1(path);
    assert_m1.throws(() => raw.prepare("DELETE FROM worker_pools").run(), /retained|never deleted/);
    raw.close();
  });
});

describe_m1("run_batches — a durable group whose membership is the run table (§11.1)", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("refuses a member that names a session authority never wrote, or another workflow's session", () => {
    const database = open(databasePath());
    assert_m1.throws(
      () => database.authority.runs.enqueue(queuedRun(RUN_ID_m1, { sessionId: OTHER_SESSION_ID })),
      /names session aaaaaaaa-0009-4000-8000-000900000000, which authority never wrote/,
    );
    assert_m1.equal(database.authority.runs.get(RUN_ID_m1), undefined);

    database.authority.runSessions.insert({ ...RUN_SESSION_m1, sessionId: OTHER_SESSION_ID, workflow: "separations" });
    assert_m1.throws(
      () => database.authority.runs.enqueue(queuedRun(RUN_ID_m1, { sessionId: OTHER_SESSION_ID })),
      /which groups separations; a session groups runs of one workflow/,
    );
  });

  it_m1("reads an admitted current ungrouped run as no session", () => {
    const path = databasePath();
    const database = open(path);
    database.authority.runs.enqueue(queuedRun(RUN_ID_m1, {}));
    database.close();
    const raw = new DatabaseSync_m1(path);
    const row = raw.prepare("SELECT batch_id AS session_id FROM runs WHERE id = ?").get(RUN_ID_m1) as { session_id: string | null };
    assert_m1.equal(row.session_id, null);
    raw.close();
    const reopened = open(path);
    const record = reopened.authority.runs.get(RUN_ID_m1);
    assert_m1.ok(record !== undefined);
    assert_m1.equal(record.sessionId, undefined);
    assert_m1.equal("sessionId" in record, false);
    reopened.close();
  });
});
}
