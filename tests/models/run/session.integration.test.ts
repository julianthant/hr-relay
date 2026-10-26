import { createSeededDashboardWorld } from "../../support/helpers/seeded-dashboard-world.js";
import { default as assert } from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { runSessionActorId } from "../../../src/models/run/session.js";
import { RunSessionRecordSchema } from "../../../src/models/run/session.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_6 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_8 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_SESSION_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_SESSION } from "../../support/fixtures/phase1f-run-fixtures.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { DAY } from "../../support/helpers/backend/dashboard-harness.js";
import { instantOffsetOf } from "../../support/helpers/backend/dashboard-harness.js";
import { makeWorld } from "../../support/helpers/backend/dashboard-harness.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";
import type { DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";

{

const profiles: ReturnType<typeof createBoundProfileFixture>[] = [];
function databasePath(): string {
  const profile = createBoundProfileFixture();
  profiles.push(profile);
  return profile.path;
}
function open(path: string): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}
const _afterEachFixture0 = () => {
  for (const profile of profiles.splice(0)) profile.close();
};

const RUN_ID_2 = "aaaaaaaa-0002-4000-8000-000200000000";
const RUN_ID_3 = "aaaaaaaa-0003-4000-8000-000300000000";

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

describe("run_batches — a durable group whose membership is the run table (§11.1)", () => {
afterEach(_afterEachFixture0);

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

    database.authority.runs.enqueue(queuedRun(RUN_ID_3, { itemId: UUID_8, traceId: "pl-170003-0003" }));

    assert.deepEqual(database.authority.runs.listBySession(RUN_SESSION_ID).map((run) => run.envelope.runId), [RUN_ID, RUN_ID_2]);
    assert.equal(database.authority.runs.get(RUN_ID)?.sessionId, RUN_SESSION_ID);
    assert.equal(database.authority.runs.get(RUN_ID_3)?.sessionId, undefined);

    assert.equal("members" in RunSessionRecordSchema.shape, false);
    database.close();

    const reopened = open(path);
    assert.deepEqual(reopened.authority.runs.listBySession(RUN_SESSION_ID).map((run) => run.envelope.runId), [RUN_ID, RUN_ID_2]);
    assert.equal(reopened.authority.runSessions.get(RUN_SESSION_ID)?.workflow, WORKFLOW_ID);
    reopened.close();
  });
});
}

{

const { queuedEventOf } = createSeededDashboardWorld();


const worlds: DashboardWorld[] = [];

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const created = makeWorld(...args);
  worlds.push(created);
  return created;
}

const _afterEachFixture0 = () => {
  for (const w of worlds.splice(0)) w.dispose();
};

describe("the queue row's ordinal, class, links and outcome", () => {
afterEach(_afterEachFixture0);

  const _ORDINAL_CLAIM = {
    workerId: "person-lookup-worker-1",
    claimedAt: "2026-08-03T17:00:05.000Z",
    heartbeatAt: "2026-08-03T17:00:05.000Z",
  } as const;

  it("serves the run's session off its own row, and names the absence of one", () => {
    const w = world();
    w.authority.batches.set(uuidOf(70), RunSessionRecordSchema.parse({ sessionId: uuidOf(70), workflow: "person-lookup", origin: { kind: "start-plan", startPlanId: uuidOf(71), actorId: "local-operator" }, startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 }));
    const nativeBatch = w.authority.batches.get(uuidOf(70)); assert.ok(nativeBatch);
    w.database.authority.runSessions.insert(nativeBatch);
    queuedEventOf(w, { seed: 1, sessionId: uuidOf(70) });
    queuedEventOf(w, { seed: 2, sessionId: uuidOf(70) });
    queuedEventOf(w, { seed: 3 });
    const rows = w.projection.buildDashboardDayWire(DAY).queueSurfaces;


    assert.deepEqual(rows[0].session, { state: "present", sessionId: uuidOf(70), origin: { kind: "start-plan", startPlanId: uuidOf(71), actorId: "local-operator" }, presentation: { groupInQueue: true, version: 1, startedAt: instantOffsetOf(0) } });
    assert.deepEqual(rows[1].session, { state: "present", sessionId: uuidOf(70), origin: { kind: "start-plan", startPlanId: uuidOf(71), actorId: "local-operator" }, presentation: { groupInQueue: true, version: 1, startedAt: instantOffsetOf(0) } });
    assert.deepEqual(rows[2].session, {
      state: "absent",
      reason: "no session grouping was recorded for this run or its retry source",
    });
  });

  it("publishes batch presentation changes without new run spans and ignores an unchanged tick", () => {
    const w = world();
    const batch = RunSessionRecordSchema.parse({ sessionId: uuidOf(70), workflow: "person-lookup", origin: { kind: "start-plan", startPlanId: uuidOf(71), actorId: "local-operator" }, startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 });
    w.authority.batches.set(batch.sessionId, batch);
    w.database.authority.runSessions.insert(batch);
    queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });
    queuedEventOf(w, { seed: 2, sessionId: batch.sessionId });
    w.projection.reconcileWorkerAuthority();
    const before = w.changes.filter((change) => change.kind === "snapshot").length;
    w.authority.batches.set(batch.sessionId, RunSessionRecordSchema.parse({ ...batch, groupInQueue: false, version: 2 }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.changes.filter((change) => change.kind === "snapshot").length, before + 1);
    for (const row of w.projection.buildDashboardDayWire(DAY).queueSurfaces) {
      assert.equal(row.session.state, "present");
      if (row.session.state === "present") assert.deepEqual(row.session.presentation, { groupInQueue: false, version: 2, startedAt: batch.startedAt });
    }
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.changes.filter((change) => change.kind === "snapshot").length, before + 1);
  });
});
}
