import { RunRecordService as RunRecordService_m0 } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { seedSyntheticRuntimeConfig as seedSyntheticRuntimeConfig_m0 } from "../../support/fixtures/operator-command-fixtures.js";

import assert_m0 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { createCommandKernel as createCommandKernel_m0,type CommandKernel as CommandKernel_m0 } from "../../../src/backend/runs/commands/command-kernel.js";
import { notificationWireOf as notificationWireOf_m0,NotificationWireSchema as NotificationWireSchema_m0 } from "../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema as NotificationRecordSchema_m0 } from "../../../src/models/notifications/notifications.js";
import { RunLifecycleSchema as RunLifecycleSchema_m1,RunRecordSchema as RunRecordSchema_m1 } from "../../../src/models/run/record.js";
import { manualClock as manualClock_m0 } from "../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS as NO_INTAKE_PROJECTIONS_m0,UNWIRED_INTAKE_PARSER as UNWIRED_INTAKE_PARSER_m0 } from "../../support/fixtures/intake-kernel-seams.js";
import { HASH_A as HASH_A_m0,LATER as LATER_m0,NOW as NOW_m0,UUID_2 as UUID_2_m0,UUID_7 as UUID_7_m0 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory as sequentialIdFactory_m0 } from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../support/helpers/synthetic-storage-admission.js";

import assert_m1 from "node:assert/strict";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { DashboardDayWireSchema as DashboardDayWireSchema_m1,QueueSurfaceWireSchema as QueueSurfaceWireSchema_m1 } from "../../../src/models/dashboard/projection.js";
import { HASH_A as HASH_A_m1,HASH_B as HASH_B_m1,UUID_4 as UUID_4_m1 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
claimEventOf as claimEventOf_m1,
DAY as DAY_m1,
DESCRIPTOR_SET_HASH as DESCRIPTOR_SET_HASH_m1,
instantOffsetOf as instantOffsetOf_m1,
makeWorld as makeWorld_m1,
queuedEventOf as queuedEventBase_m1,
runRecordOf as runRecordBase_m1,
taskEventsOf as taskEventsOf_m1,
traceOf as traceOf_m1,
uuidOf as uuidOf_m1,
type DashboardWorld as DashboardWorld_m1
} from "../../support/helpers/backend/dashboard-harness.js";


{


const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const ACTOR = "local-operator";

function record(overrides: Record<string, unknown> = {}) {
  return NotificationRecordSchema_m0.parse({
    notificationId: UUID_7_m0,
    actorId: ACTOR,
    dedupeFingerprint: HASH_A_m0,
    trigger: "failed",
    channel: "ping",
    status: "unread",
    snooze: { state: "not-snoozed" },
    title: "Run failed",
    summary: "person-lookup run failed at cross-verify",
    links: [{ kind: "run", runId: UUID_2_m0 }],
    count: 1,
    lastSeenAt: NOW_m0,
    version: 1,
    createdAt: NOW_m0,
    updatedAt: NOW_m0,
    ...overrides,
  });
}

function harness(): { database: AuthorityDatabase_m0; kernel: CommandKernel_m0 } {
  const clock = manualClock_m0(new Date(LATER_m0));
  const root = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "hrauto-inbox-"));
  disposers.push(() => rmSync_m0(root, { recursive: true, force: true }));
  const database = AuthorityDatabase_m0.open(
    { path: join_m0(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "inbox-test" },
    clock,
  );
  disposers.push(() => database.close());
  seedSyntheticRuntimeConfig_m0(database);
  const active = database.authority.runtimeConfig.get(); assert_m0.ok(active);
  const kernel = createCommandKernel_m0({
    lifecycle: new RunRecordService_m0({ database: database, clock: clock, ids: sequentialIdFactory_m0("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
    intakeParser: UNWIRED_INTAKE_PARSER_m0,
    intakeProjections: NO_INTAKE_PROJECTIONS_m0,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(repositories),
      ),
    },
    clock,
    ids: sequentialIdFactory_m0("c"),
    descriptors: { resolve: () => undefined },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("unexpected worker command"); }, spawnPoolWorker: () => { throw new Error("unexpected worker command"); }, refreshPoolBrowser: () => { throw new Error("unexpected worker command"); }, reopenPoolBrowser: () => { throw new Error("unexpected worker command"); }, stopPoolWorker: () => { throw new Error("unexpected worker command"); }, pausePoolWorker: () => { throw new Error("unexpected worker command"); }, resumePoolWorker: () => { throw new Error("unexpected worker command"); } } },
  });
  return { database, kernel };
}

let sequence = 0;
function command(type: string, expectedVersion: number, extra: Record<string, unknown> = {}) {
  sequence += 1;
  const tail = String(sequence).padStart(4, "0");
  return {
    commandId: `eeeeeeee-${tail}-4000-8000-${tail}00000000`,
    requestedAt: LATER_m0,
    requestedBy: ACTOR,
    source: "notification-bell",
    family: "notification",
    type,
    target: { notificationId: UUID_7_m0, actorId: ACTOR, expectedVersion },
    ...extra,
  };
}

describe_m0("notificationWireOf", () => {
afterEach_m0(_afterEachFixture0);

  const nowMs = Date.parse(LATER_m0);

  it_m0("serves a closed pinned arm with no lifecycle revision or invented link", () => {
    const wire = notificationWireOf_m0(record({
      trigger: "backfill-gap",
      title: "Notification history is incomplete",
      links: [],
    }), nowMs);

    assert_m0.deepEqual(wire, {
      kind: "backfill-gap",
      channel: "ping", count: 1,
      publicationId: "884926bc73b2ee67b639aeab1c2ca18bb77f295027642c812516aed141fc8bdc",
      notificationId: UUID_7_m0,
      actorId: ACTOR,
      severity: "error",
      title: "Notification history is incomplete",
      sourceEvent: { state: "unavailable" },
      state: "pinned",
      occurredAt: NOW_m0,
    });
    assert_m0.equal(NotificationWireSchema_m0.safeParse({ ...wire, revision: 1 }).success, false);
    assert_m0.equal(NotificationWireSchema_m0.safeParse({ ...wire, link: { kind: "run", runId: UUID_2_m0 } }).success, false);
    assert_m0.equal(NotificationWireSchema_m0.safeParse({ ...wire, state: "unread" }).success, false);
    assert_m0.equal(NotificationWireSchema_m0.safeParse({ ...wire, channel: "inbox" }).success, false);
    assert_m0.equal(NotificationWireSchema_m0.safeParse({ ...wire, count: 2 }).success, false);
  });

  it_m0("maps severity by trigger and state by status", () => {
    const wire = notificationWireOf_m0(record(), nowMs);
    assert_m0.equal(wire.severity, "error");
    assert_m0.equal(wire.state, "unread");
    assert_m0.equal(wire.revision, 1);
    assert_m0.equal(notificationWireOf_m0(record({ trigger: "gate-waiting" }), nowMs).severity, "warning");
    assert_m0.equal(
      notificationWireOf_m0(record({ trigger: "verified-done", channel: "inbox" }), nowMs).severity,
      "info",
    );
  });

  it_m0("reads snoozed only while the snooze is in force", () => {
    const active = notificationWireOf_m0(record({
      snooze: { state: "snoozed", until: "2026-07-31T19:00:00.000Z" },
    }), nowMs);
    assert_m0.equal(active.state, "snoozed");
    const expired = notificationWireOf_m0(record({
      status: "read",
      snooze: { state: "snoozed", until: "2026-07-31T17:00:30.000Z" },
      updatedAt: "2026-07-31T17:00:29.000Z",
    }), nowMs);
    assert_m0.equal(expired.state, "read");
  });
});

it_m0("read/snooze commands preserve publication identity, count, and expired snooze evidence", async () => {
try {


  const { database, kernel } = harness();
  const initial = record({ snooze: { state: "snoozed", until: "2026-07-31T17:00:30.000Z" } });
  database.authority.notifications.create(initial);
  const before = notificationWireOf_m0(initial, Date.parse(LATER_m0));
  assert_m0.equal(kernel.execute(command("notification-read", 1)).state, "applied");
  const updated = database.authority.notifications.get(UUID_7_m0);
  assert_m0.ok(updated);
  const after = notificationWireOf_m0(updated, Date.parse(LATER_m0));
  assert_m0.equal(before.kind, "notification"); assert_m0.equal(after.kind, "notification");
  if (before.kind !== "notification" || after.kind !== "notification") throw new Error("ordinary row expected");
  assert_m0.equal(after.publicationId, before.publicationId); assert_m0.equal(after.count, 1);
  assert_m0.equal(after.readState, "read"); assert_m0.deepEqual(updated.snooze, initial.snooze);
  assert_m0.equal(after.title, "Run failed");

} finally {
_afterEachFixture0();
}
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

const CLAIM = {
  workerId: "person-lookup-worker-1",
  claimedAt: "2026-08-03T17:00:05.000Z",
  heartbeatAt: "2026-08-03T17:00:05.000Z",
} as const;

/** Seeds: queued(1), running(2), done(3), failed(4), queued(5), operation(6)+members(7,8), gated(9). */
function seedWorld(w: DashboardWorld_m1): void {
  queuedEventOf(w, { seed: 1 });

  queuedEventOf(w, { seed: 2 });
  w.authority.put(runRecordOf({ seed: 2, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1, version: 2 }));
  claimEventOf_m1(w, 2);
  taskEventsOf_m1(w, 2, "searching");

  queuedEventOf(w, { seed: 3 });
  claimEventOf_m1(w, 3);
  taskEventsOf_m1(w, 3, "searching", "done");
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf_m1(3), attempt: 1, traceId: traceOf_m1(3), spanPath: traceOf_m1(3), outcome: "done",
  });
  w.authority.put(runRecordOf({
    seed: 3,
    lifecycle: { state: "terminal", outcome: "done", endedAt: "2026-08-03T17:10:00.000Z" },
    version: 3,
  }));

  queuedEventOf(w, { seed: 4 });
  claimEventOf_m1(w, 4);
  taskEventsOf_m1(w, 4, "searching", "failed");
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf_m1(4), attempt: 1, traceId: traceOf_m1(4), spanPath: traceOf_m1(4),
    outcome: "failed", failureId: uuidOf_m1(9004),
  });
  w.authority.put(runRecordOf({
    seed: 4,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:12:00.000Z", failureId: uuidOf_m1(9004) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 5 });

  queuedEventOf(w, { seed: 6, shape: "operation", title: "I-9 batch" });
  queuedEventOf(w, { seed: 7, shape: "operation-member", parentSeed: 6 });
  queuedEventOf(w, { seed: 8, shape: "operation-member", parentSeed: 6 });
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf_m1(8), attempt: 1, traceId: traceOf_m1(8), spanPath: traceOf_m1(8),
    outcome: "failed", failureId: uuidOf_m1(9008),
  });
  w.authority.put(runRecordOf({
    seed: 8, shape: "operation-member", parentSeed: 6,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:13:00.000Z", failureId: uuidOf_m1(9008) },
    version: 2,
  }));

  queuedEventOf(w, { seed: 9, lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: instantOffsetOf_m1(0), resumeAt: "approval" } });
  w.writer.emit({
    t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf_m1(9), attempt: 1, traceId: traceOf_m1(9), spanPath: traceOf_m1(9), gate: "approval",
  });
}

describe_m1("THE run/queue projection", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("folds the seeded world into one payload whose three count renderings agree by construction", () => {
    const w = world();
    seedWorld(w);
    const day = w.projection.buildDashboardDayWire(DAY_m1);
    DashboardDayWireSchema_m1.parse(day);


    const runIds: readonly string[] = day.queueSurfaces.map(({ runId }) => runId);
    assert_m1.equal(runIds.includes(uuidOf_m1(5)), true, "run 5 remains visible with every current run");
    assert_m1.equal(runIds.includes(uuidOf_m1(7)), true);
    assert_m1.equal(day.queueSurfaces.length, 9);

    const topLevel = day.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member");
    const workflowTotal = day.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    const statusTotal = day.statusCounts.reduce((sum, { count }) => sum + count, 0);
    assert_m1.equal(workflowTotal, topLevel.length);
    assert_m1.equal(statusTotal, topLevel.length);
    assert_m1.equal(workflowTotal, 7);
    assert_m1.deepEqual(day.monthCounts, [{ day: DAY_m1, count: 7 }]);

    const statusOf = (seed: number): string | undefined =>
      day.queueSurfaces.find(({ runId }) => runId === uuidOf_m1(seed))?.status;
    assert_m1.equal(statusOf(1), "queued");
    assert_m1.equal(statusOf(2), "running");
    assert_m1.equal(statusOf(3), "done");
    assert_m1.equal(statusOf(4), "failed");
    assert_m1.equal(statusOf(9), "awaiting-approval");

    const operation = day.queueSurfaces.find(({ runId }) => runId === uuidOf_m1(6));
    assert_m1.equal(operation?.surfaceKind, "operation");
    if (operation?.surfaceKind !== "operation") assert_m1.fail("operation surface missing");
    assert_m1.deepEqual([...operation.memberRunIds].sort(), [uuidOf_m1(7), uuidOf_m1(8)].sort());
    assert_m1.deepEqual(operation.memberRollup, { total: 2, terminal: 1, failed: 1 });

    const running = day.queueSurfaces.find(({ runId }) => runId === uuidOf_m1(2));
    assert_m1.deepEqual(running?.pipeline, [{ id: "searching", label: "searching", state: "active" }]);
    assert_m1.equal(running?.rowRevision, 2);

    const failed = day.queueSurfaces.find(({ runId }) => runId === uuidOf_m1(4));
    assert_m1.equal(failed?.availableSections.includes("failure"), true);
    assert_m1.equal(day.descriptorHash, DESCRIPTOR_SET_HASH_m1);

    assert_m1.equal(
      day.queueSurfaces.every(({ appVersion }) => appVersion.state === "absent"),
      true,
    );


    assert_m1.equal(day.queueSurfaces.every(({ actions }) => actions.length === 0), true);
  });



  /** A raw stream line as ANOTHER process would append it — no writer, no apply. */
  function _rawQueuedLineOf(w: DashboardWorld_m1, seed: number, workflow: string): string {
    return JSON.stringify({
      t: "run.queued", kind: "run", pid: 777,
      ts: w.clock.now().toISOString(),
      workflow,
      runId: uuidOf_m1(seed), attempt: 1,
      traceId: traceOf_m1(seed), spanPath: traceOf_m1(seed),
      itemId: uuidOf_m1(seed + 5000),
      shape: "single", priority: "interactive", dryRun: false,
      actorId: "local-operator",
      title: `raw #${String(seed)}`,
      descriptorVersion: 1,
      contractFingerprint: HASH_A_m1,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: HASH_B_m1,
      configSnapshotId: UUID_4_m1,
    });
  }
});


describe_m1("the queue row's served facts", () => {
afterEach_m1(_afterEachFixture0);

  /** A terminal-failed run whose failure record authority holds. */
  function _seedFailed(w: DashboardWorld_m1, seed = 4): void {
    queuedEventOf(w, { seed });
    claimEventOf_m1(w, seed);
    taskEventsOf_m1(w, seed, "searching", "failed");
    w.writer.emit({
      t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf_m1(seed), attempt: 1, traceId: traceOf_m1(seed), spanPath: traceOf_m1(seed),
      outcome: "failed", failureId: uuidOf_m1(seed + 9000),
    });
    w.authority.put(runRecordOf({
      seed,
      lifecycle: {
        state: "terminal", outcome: "failed",
        endedAt: "2026-08-03T17:12:00.000Z", failureId: uuidOf_m1(seed + 9000),
      },
      version: 3,
    }));
  }

  function rowOf(w: DashboardWorld_m1, seed: number) {
    const surface = w.projection.buildDashboardDayWire(DAY_m1).queueSurfaces
      .find((row) => row.runId === uuidOf_m1(seed));
    assert_m1.ok(surface);
    return surface;
  }

  it_m1("the wire refuses a gate instant on a row that is not waiting", () => {
    const w = world();
    seedWorld(w);
    const running = rowOf(w, 2);
    assert_m1.equal(QueueSurfaceWireSchema_m1.safeParse({
      ...running,
      gateOpenedAt: { state: "present", value: "2026-08-03T17:05:00.000Z" },
    }).success, false);
  });
});
}
