import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { seedSyntheticRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";
import { default as assert } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { realpathSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { createCommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import type { CommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { notificationWireOf } from "../../../src/models/dashboard/projection.js";
import { NotificationWireSchema } from "../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema } from "../../../src/models/notifications/notifications.js";
import { RunLifecycleSchema } from "../../../src/models/run/record.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS } from "../../support/fixtures/intake-kernel-seams.js";
import { UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";
import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { LATER } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_2 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { DashboardDayWireSchema } from "../../../src/models/dashboard/projection.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { claimEventOf } from "../../support/helpers/backend/dashboard-harness.js";
import { DAY } from "../../support/helpers/backend/dashboard-harness.js";
import { DESCRIPTOR_SET_HASH } from "../../support/helpers/backend/dashboard-harness.js";
import { instantOffsetOf } from "../../support/helpers/backend/dashboard-harness.js";
import { makeWorld } from "../../support/helpers/backend/dashboard-harness.js";
import { queuedEventOf as queuedEventBase } from "../../support/helpers/backend/dashboard-harness.js";
import { runRecordOf as runRecordBase } from "../../support/helpers/backend/dashboard-harness.js";
import { taskEventsOf } from "../../support/helpers/backend/dashboard-harness.js";
import { traceOf } from "../../support/helpers/backend/dashboard-harness.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";
import type { DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";

{

const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const ACTOR = "local-operator";

function record(overrides: Record<string, unknown> = {}) {
  return NotificationRecordSchema.parse({
    notificationId: UUID_7,
    actorId: ACTOR,
    dedupeFingerprint: HASH_A,
    trigger: "failed",
    channel: "ping",
    status: "unread",
    snooze: { state: "not-snoozed" },
    title: "Run failed",
    summary: "person-lookup run failed at cross-verify",
    links: [{ kind: "run", runId: UUID_2 }],
    count: 1,
    lastSeenAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function harness(): { database: AuthorityDatabase; kernel: CommandKernel } {
  const clock = manualClock(new Date(LATER));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-inbox-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "inbox-test" },
    clock,
  );
  disposers.push(() => database.close());
  seedSyntheticRuntimeConfig(database);
  const active = database.authority.runtimeConfig.get(); assert.ok(active);
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(repositories),
      ),
    },
    clock,
    ids: sequentialIdFactory("c"),
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
    requestedAt: LATER,
    requestedBy: ACTOR,
    source: "notification-bell",
    family: "notification",
    type,
    target: { notificationId: UUID_7, actorId: ACTOR, expectedVersion },
    ...extra,
  };
}

describe("notificationWireOf", () => {
afterEach(_afterEachFixture0);

  const nowMs = Date.parse(LATER);

  it("serves a closed pinned arm with no lifecycle revision or invented link", () => {
    const wire = notificationWireOf(record({
      trigger: "backfill-gap",
      title: "Notification history is incomplete",
      links: [],
    }), nowMs);

    assert.deepEqual(wire, {
      kind: "backfill-gap",
      channel: "ping", count: 1,
      publicationId: "884926bc73b2ee67b639aeab1c2ca18bb77f295027642c812516aed141fc8bdc",
      notificationId: UUID_7,
      actorId: ACTOR,
      severity: "error",
      title: "Notification history is incomplete",
      sourceEvent: { state: "unavailable" },
      state: "pinned",
      occurredAt: NOW,
    });
    assert.equal(NotificationWireSchema.safeParse({ ...wire, revision: 1 }).success, false);
    assert.equal(NotificationWireSchema.safeParse({ ...wire, link: { kind: "run", runId: UUID_2 } }).success, false);
    assert.equal(NotificationWireSchema.safeParse({ ...wire, state: "unread" }).success, false);
    assert.equal(NotificationWireSchema.safeParse({ ...wire, channel: "inbox" }).success, false);
    assert.equal(NotificationWireSchema.safeParse({ ...wire, count: 2 }).success, false);
  });

  it("maps severity by trigger and state by status", () => {
    const wire = notificationWireOf(record(), nowMs);
    assert.equal(wire.severity, "error");
    assert.equal(wire.state, "unread");
    assert.equal(wire.revision, 1);
    assert.equal(notificationWireOf(record({ trigger: "gate-waiting" }), nowMs).severity, "warning");
    assert.equal(
      notificationWireOf(record({ trigger: "verified-done", channel: "inbox" }), nowMs).severity,
      "info",
    );
  });

  it("reads snoozed only while the snooze is in force", () => {
    const active = notificationWireOf(record({
      snooze: { state: "snoozed", until: "2026-07-31T19:00:00.000Z" },
    }), nowMs);
    assert.equal(active.state, "snoozed");
    const expired = notificationWireOf(record({
      status: "read",
      snooze: { state: "snoozed", until: "2026-07-31T17:00:30.000Z" },
      updatedAt: "2026-07-31T17:00:29.000Z",
    }), nowMs);
    assert.equal(expired.state, "read");
  });
});

it("read/snooze commands preserve publication identity, count, and expired snooze evidence", async () => {
try {

  const { database, kernel } = harness();
  const initial = record({ snooze: { state: "snoozed", until: "2026-07-31T17:00:30.000Z" } });
  database.authority.notifications.create(initial);
  const before = notificationWireOf(initial, Date.parse(LATER));
  assert.equal(kernel.execute(command("notification-read", 1)).state, "applied");
  const updated = database.authority.notifications.get(UUID_7);
  assert.ok(updated);
  const after = notificationWireOf(updated, Date.parse(LATER));
  assert.equal(before.kind, "notification"); assert.equal(after.kind, "notification");
  if (before.kind !== "notification" || after.kind !== "notification") throw new Error("ordinary row expected");
  assert.equal(after.publicationId, before.publicationId); assert.equal(after.count, 1);
  assert.equal(after.readState, "read"); assert.deepEqual(updated.snooze, initial.snooze);
  assert.equal(after.title, "Run failed");

} finally {
_afterEachFixture0();
}
});
}

{

function runRecordOf(input: Parameters<typeof runRecordBase>[0]) {
  const lifecycle = RunLifecycleSchema.parse(input.lifecycle ?? {state:"queued"});
  if (lifecycle.state !== "terminal" || !["done","failed"].includes(lifecycle.outcome)) return runRecordBase(input);
  const base = runRecordBase({...input,lifecycle:{state:"queued"}});
  const version = Math.max(2,base.version), claimGeneration = Math.max(1,base.claimGeneration);
  return RunRecordSchema.parse({...base,lifecycle,version,claimGeneration,updatedAt:lifecycle.endedAt,completion:{
    schemaVersion:1,kind:lifecycle.outcome,expectedVersion:version-1,
    claim:{workerId:"queue-fixture-worker",claimGeneration},authorizedAt:lifecycle.endedAt,
    ...(lifecycle.outcome === "done" ? {resultDigest:"a".repeat(64)} : {failureId:lifecycle.failureId}),
  }});
}
function queuedEventOf(w: DashboardWorld, input: Parameters<typeof runRecordBase>[0]) {
  const event = queuedEventBase(w,{...input,lifecycle:{state:"queued"}});
  if (input.lifecycle !== undefined) w.authority.put(runRecordOf({...input,enqueuedAt:input.enqueuedAt ?? w.clock.now().toISOString()}));
  return event;
}

const worlds: DashboardWorld[] = [];

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const created = makeWorld(...args);
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

function seedWorld(w: DashboardWorld): void {
  queuedEventOf(w, { seed: 1 });

  queuedEventOf(w, { seed: 2 });
  w.authority.put(runRecordOf({ seed: 2, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1, version: 2 }));
  claimEventOf(w, 2);
  taskEventsOf(w, 2, "searching");

  queuedEventOf(w, { seed: 3 });
  claimEventOf(w, 3);
  taskEventsOf(w, 3, "searching", "done");
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(3), attempt: 1, traceId: traceOf(3), spanPath: traceOf(3), outcome: "done",
  });
  w.authority.put(runRecordOf({
    seed: 3,
    lifecycle: { state: "terminal", outcome: "done", endedAt: "2026-08-03T17:10:00.000Z" },
    version: 3,
  }));

  queuedEventOf(w, { seed: 4 });
  claimEventOf(w, 4);
  taskEventsOf(w, 4, "searching", "failed");
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(4), attempt: 1, traceId: traceOf(4), spanPath: traceOf(4),
    outcome: "failed", failureId: uuidOf(9004),
  });
  w.authority.put(runRecordOf({
    seed: 4,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:12:00.000Z", failureId: uuidOf(9004) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 5 });

  queuedEventOf(w, { seed: 6, shape: "operation", title: "I-9 batch" });
  queuedEventOf(w, { seed: 7, shape: "operation-member", parentSeed: 6 });
  queuedEventOf(w, { seed: 8, shape: "operation-member", parentSeed: 6 });
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(8), attempt: 1, traceId: traceOf(8), spanPath: traceOf(8),
    outcome: "failed", failureId: uuidOf(9008),
  });
  w.authority.put(runRecordOf({
    seed: 8, shape: "operation-member", parentSeed: 6,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:13:00.000Z", failureId: uuidOf(9008) },
    version: 2,
  }));

  queuedEventOf(w, { seed: 9, lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: instantOffsetOf(0), resumeAt: "approval" } });
  w.writer.emit({
    t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(9), attempt: 1, traceId: traceOf(9), spanPath: traceOf(9), gate: "approval",
  });
}

describe("THE run/queue projection", () => {
afterEach(_afterEachFixture0);

  it("folds the seeded world into one payload whose three count renderings agree by construction", () => {
    const w = world();
    seedWorld(w);
    const day = w.projection.buildDashboardDayWire(DAY);
    DashboardDayWireSchema.parse(day);

    const runIds: readonly string[] = day.queueSurfaces.map(({ runId }) => runId);
    assert.equal(runIds.includes(uuidOf(5)), true, "run 5 remains visible with every current run");
    assert.equal(runIds.includes(uuidOf(7)), true);
    assert.equal(day.queueSurfaces.length, 9);

    const topLevel = day.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member");
    const workflowTotal = day.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    const statusTotal = day.statusCounts.reduce((sum, { count }) => sum + count, 0);
    assert.equal(workflowTotal, topLevel.length);
    assert.equal(statusTotal, topLevel.length);
    assert.equal(workflowTotal, 7);
    assert.deepEqual(day.monthCounts, [{ day: DAY, count: 7 }]);

    const statusOf = (seed: number): string | undefined =>
      day.queueSurfaces.find(({ runId }) => runId === uuidOf(seed))?.status;
    assert.equal(statusOf(1), "queued");
    assert.equal(statusOf(2), "running");
    assert.equal(statusOf(3), "done");
    assert.equal(statusOf(4), "failed");
    assert.equal(statusOf(9), "awaiting-approval");

    const operation = day.queueSurfaces.find(({ runId }) => runId === uuidOf(6));
    assert.equal(operation?.surfaceKind, "operation");
    if (operation?.surfaceKind !== "operation") assert.fail("operation surface missing");
    assert.deepEqual([...operation.memberRunIds].sort(), [uuidOf(7), uuidOf(8)].sort());
    assert.deepEqual(operation.memberRollup, { total: 2, terminal: 1, failed: 1 });

    const running = day.queueSurfaces.find(({ runId }) => runId === uuidOf(2));
    assert.deepEqual(running?.pipeline, [{ id: "searching", label: "searching", state: "active" }]);
    assert.equal(running?.rowRevision, 2);

    const failed = day.queueSurfaces.find(({ runId }) => runId === uuidOf(4));
    assert.equal(failed?.availableSections.includes("failure"), true);
    assert.equal(day.descriptorHash, DESCRIPTOR_SET_HASH);

    assert.equal(
      day.queueSurfaces.every(({ appVersion }) => appVersion.state === "absent"),
      true,
    );

    assert.equal(day.queueSurfaces.every(({ actions }) => actions.length === 0), true);
  });
});

describe("the queue row's served facts", () => {
afterEach(_afterEachFixture0);

  function rowOf(w: DashboardWorld, seed: number) {
    const surface = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((row) => row.runId === uuidOf(seed));
    assert.ok(surface);
    return surface;
  }

  it("the wire refuses a gate instant on a row that is not waiting", () => {
    const w = world();
    seedWorld(w);
    const running = rowOf(w, 2);
    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...running,
      gateOpenedAt: { state: "present", value: "2026-08-03T17:05:00.000Z" },
    }).success, false);
  });
});
}
