
import assert_m0 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m0,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { DatabaseSync as DatabaseSync_m0 } from "node:sqlite";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { RunLifecycleSchema as RunLifecycleSchema_m1,RunRecordSchema as RunRecordSchema_m1 } from "../../../src/models/run/record.js";
import { runSessionActorId as runSessionActorId_m0,RunSessionRecordSchema as RunSessionRecordSchema_m0,RunSessionRecordSchema as RunSessionRecordSchema_m1 } from "../../../src/models/run/session.js";
import { manualClock as manualClock_m0 } from "../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m0,NOW as NOW_m0,UUID_6 as UUID_6_m0,UUID_8 as UUID_8_m0 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m0,RUN_ID as RUN_ID_m0,RUN_SESSION_ID as RUN_SESSION_ID_m0,RUN_SESSION as RUN_SESSION_m0,WORKFLOW_ID as WORKFLOW_ID_m0 } from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../support/helpers/synthetic-storage-admission.js";

import assert_m1 from "node:assert/strict";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import {
claimEventOf as claimEventOf_m1,
DAY as DAY_m1,
instantOffsetOf as instantOffsetOf_m1,
makeWorld as makeWorld_m1,
queuedEventOf as queuedEventBase_m1,
runEndedEventOf as runEndedEventOf_m1,
runRecordOf as runRecordBase_m1,
uuidOf as uuidOf_m1,
type DashboardWorld as DashboardWorld_m1
} from "../../support/helpers/backend/dashboard-harness.js";


{


const roots: string[] = [];
function databasePath(): string {
  const root = mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-parallel-runs-authority-"));
  roots.push(root);
  return join_m0(root, "authority.sqlite");
}
function open(path: string): AuthorityDatabase_m0 {
  const database = AuthorityDatabase_m0.open(
    { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock_m0(new Date(NOW_m0)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m0);
  return database;
}
const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true });
};

const RUN_ID_2 = "aaaaaaaa-0002-4000-8000-000200000000";
const RUN_ID_3 = "aaaaaaaa-0003-4000-8000-000300000000";

function queuedRun(
  runId: string,
  overrides: Readonly<{ itemId?: string; traceId?: string; workflow?: string; sessionId?: string }>,
): Record<string, unknown> {
  const { sessionId, ...envelopeOverrides } = overrides;
  return {
    ...QUEUED_RUN_m0,
    envelope: { ...QUEUED_RUN_m0.envelope, runId, ...envelopeOverrides },
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

describe_m0("run_batches — a durable group whose membership is the run table (§11.1)", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("inserts immutably, and reads the actor off the origin", () => {
    const path = databasePath();
    const database = open(path);
    const first = database.authority.runSessions.insert(RUN_SESSION_m0);
    assert_m0.equal(first.state, "inserted");
    assert_m0.equal(database.authority.runSessions.insert(RUN_SESSION_m0).state, "existing");
    assert_m0.throws(
      () => database.authority.runSessions.insert({ ...RUN_SESSION_m0, startedAt: "2026-07-31T17:00:01.000Z", createdAt: "2026-07-31T17:00:01.000Z" }),
      /already exists with different content/,
    );
    const stored = database.authority.runSessions.get(RUN_SESSION_ID_m0);
    assert_m0.ok(stored !== undefined);
    assert_m0.equal(runSessionActorId_m0(stored), "local-operator");
    assert_m0.deepEqual(database.authority.runSessions.listByWorkflow(WORKFLOW_ID_m0).map((s) => s.sessionId), [RUN_SESSION_ID_m0]);
    database.close();

    const raw = new DatabaseSync_m0(path);
    assert_m0.throws(() => raw.prepare("UPDATE run_batches SET workflow = 'x'").run(), /run-batches-presentation/);
    assert_m0.throws(() => raw.prepare("DELETE FROM run_batches").run(), /retained|never deleted/);
    raw.close();
  });

  it_m0("stores NO member list: membership is the run rows that carry the id, and it survives a reopen", () => {
    const path = databasePath();
    const database = open(path);
    database.authority.runSessions.insert(RUN_SESSION_m0);
    database.authority.runs.enqueue(queuedRun(RUN_ID_m0, { sessionId: RUN_SESSION_ID_m0 }));
    database.authority.runs.enqueue(queuedRun(RUN_ID_2, { itemId: UUID_6_m0, traceId: "pl-170002-0002", sessionId: RUN_SESSION_ID_m0 }));
    // A run no fan-out grouped — the pre-v17 shape — is not a member of anything.
    database.authority.runs.enqueue(queuedRun(RUN_ID_3, { itemId: UUID_8_m0, traceId: "pl-170003-0003" }));

    assert_m0.deepEqual(database.authority.runs.listBySession(RUN_SESSION_ID_m0).map((run) => run.envelope.runId), [RUN_ID_m0, RUN_ID_2]);
    assert_m0.equal(database.authority.runs.get(RUN_ID_m0)?.sessionId, RUN_SESSION_ID_m0);
    assert_m0.equal(database.authority.runs.get(RUN_ID_3)?.sessionId, undefined);
    // The session record itself names no members — the schema has no such field.
    assert_m0.equal("members" in RunSessionRecordSchema_m0.shape, false);
    database.close();

    const reopened = open(path);
    assert_m0.deepEqual(reopened.authority.runs.listBySession(RUN_SESSION_ID_m0).map((run) => run.envelope.runId), [RUN_ID_m0, RUN_ID_2]);
    assert_m0.equal(reopened.authority.runSessions.get(RUN_SESSION_ID_m0)?.workflow, WORKFLOW_ID_m0);
    reopened.close();
  });
});
}

{


/** C completion contract: projection fixtures still carry a valid terminal settlement. */
function runRecordOf(input: Parameters<typeof runRecordBase_m1>[0]) {
  const lifecycle = RunLifecycleSchema_m1.parse(input.lifecycle ?? {state:"queued"});
  if (lifecycle.state !== "terminal" || !["done","failed"].includes(lifecycle.outcome)) return runRecordBase_m1(input);
  const base = runRecordBase_m1({...input,lifecycle:{state:"queued"}});
  const version = Math.max(2,base.version), claimGeneration = Math.max(1,base.claimGeneration);
  return RunRecordSchema_m1.parse({...base,lifecycle,version,claimGeneration,updatedAt:lifecycle.endedAt,completion:{
    schemaVersion:1,kind:lifecycle.outcome,expectedVersion:version-1,
    claim:{workerId:"queue-fixture-worker",claimGeneration},authorizedAt:lifecycle.endedAt,
    ...(lifecycle.outcome === "done" ? {resultDigest:"a".repeat(64)} : {failureId:lifecycle.failureId}),
  }});
}
function queuedEventOf(w: DashboardWorld_m1, input: Parameters<typeof runRecordBase_m1>[0]) {
  const event = queuedEventBase_m1(w,{...input,lifecycle:{state:"queued"}});
  if (input.lifecycle !== undefined) w.authority.put(runRecordOf({...input,enqueuedAt:input.enqueuedAt ?? w.clock.now().toISOString()}));
  return event;
}

const worlds: DashboardWorld_m1[] = [];

function world(...args: Parameters<typeof makeWorld_m1>): DashboardWorld_m1 {
  const created = makeWorld_m1(...args);
  worlds.push(created);
  return created;
}

const _afterEachFixture0 = () => {
  for (const w of worlds.splice(0)) w.dispose();
};


describe_m1("the queue row's ordinal, class, links and outcome", () => {
afterEach_m1(_afterEachFixture0);

  const _ORDINAL_CLAIM = {
    workerId: "person-lookup-worker-1",
    claimedAt: "2026-08-03T17:00:05.000Z",
    heartbeatAt: "2026-08-03T17:00:05.000Z",
  } as const;

  function _terminalDone(w: DashboardWorld_m1, seed: number, over: Record<string, unknown> = {}): void {
    queuedEventOf(w, { seed, ...over });
    claimEventOf_m1(w, seed);
    runEndedEventOf_m1(w, seed, "done");
    w.authority.put(runRecordOf({
      seed,
      ...over,
      lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf_m1(0, 60_000) },
      claimGeneration: 1,
      version: 3,
    }));
  }

  it_m1("serves the run's session off its own row, and names the absence of one", () => {
    const w = world();
    w.authority.batches.set(uuidOf_m1(70), RunSessionRecordSchema_m1.parse({ sessionId: uuidOf_m1(70), workflow: "person-lookup", origin: { kind: "start-plan", startPlanId: uuidOf_m1(71), actorId: "local-operator" }, startedAt: instantOffsetOf_m1(0), createdAt: instantOffsetOf_m1(0), groupInQueue: true, version: 1 }));
    const nativeBatch = w.authority.batches.get(uuidOf_m1(70)); assert_m1.ok(nativeBatch);
    w.database.authority.runSessions.insert(nativeBatch);
    queuedEventOf(w, { seed: 1, sessionId: uuidOf_m1(70) });
    queuedEventOf(w, { seed: 2, sessionId: uuidOf_m1(70) });
    queuedEventOf(w, { seed: 3 });
    const rows = w.projection.buildDashboardDayWire(DAY_m1).queueSurfaces;
    // Membership is the row's own field — two rows naming one session ARE that
    // session's membership, with no stored list consulted.
    assert_m1.deepEqual(rows[0].session, { state: "present", sessionId: uuidOf_m1(70), presentation: { groupInQueue: true, version: 1, startedAt: instantOffsetOf_m1(0) } });
    assert_m1.deepEqual(rows[1].session, { state: "present", sessionId: uuidOf_m1(70), presentation: { groupInQueue: true, version: 1, startedAt: instantOffsetOf_m1(0) } });
    assert_m1.deepEqual(rows[2].session, {
      state: "absent",
      reason: "no session grouping was recorded for this run or its retry source",
    });
  });

  it_m1("publishes batch presentation changes without new run spans and ignores an unchanged tick", () => {
    const w = world();
    const batch = RunSessionRecordSchema_m1.parse({ sessionId: uuidOf_m1(70), workflow: "person-lookup", origin: { kind: "start-plan", startPlanId: uuidOf_m1(71), actorId: "local-operator" }, startedAt: instantOffsetOf_m1(0), createdAt: instantOffsetOf_m1(0), groupInQueue: true, version: 1 });
    w.authority.batches.set(batch.sessionId, batch);
    w.database.authority.runSessions.insert(batch);
    queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });
    queuedEventOf(w, { seed: 2, sessionId: batch.sessionId });
    w.projection.reconcileWorkerAuthority();
    const before = w.changes.filter((change) => change.kind === "snapshot").length;
    w.authority.batches.set(batch.sessionId, RunSessionRecordSchema_m1.parse({ ...batch, groupInQueue: false, version: 2 }));
    w.projection.reconcileWorkerAuthority();
    assert_m1.equal(w.changes.filter((change) => change.kind === "snapshot").length, before + 1);
    for (const row of w.projection.buildDashboardDayWire(DAY_m1).queueSurfaces) {
      assert_m1.equal(row.session.state, "present");
      if (row.session.state === "present") assert_m1.deepEqual(row.session.presentation, { groupInQueue: false, version: 2, startedAt: batch.startedAt });
    }
    w.projection.reconcileWorkerAuthority();
    assert_m1.equal(w.changes.filter((change) => change.kind === "snapshot").length, before + 1);
  });
});
}
