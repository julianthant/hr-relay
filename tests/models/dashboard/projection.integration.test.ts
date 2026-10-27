import { createNotificationInboxTestWorld } from "../../support/helpers/backend/notification-inbox-world.js";
import { createSeededDashboardWorld } from "../../support/helpers/seeded-dashboard-world.js";


import { default as assert } from "node:assert/strict";





import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";


import { notificationWireOf } from "../../../src/models/dashboard/projection.js";
import { NotificationWireSchema } from "../../../src/models/dashboard/projection.js";





import { LATER } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_2 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";


import { DashboardDayWireSchema } from "../../../src/models/dashboard/projection.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { DAY } from "../../support/helpers/backend/dashboard-harness.js";
import { DESCRIPTOR_SET_HASH } from "../../support/helpers/backend/dashboard-harness.js";
import { makeWorld } from "../../support/helpers/backend/dashboard-harness.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";
import type { DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";

{

const { _afterEachFixture0, ACTOR, record, harness, command } = createNotificationInboxTestWorld();

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

  const { database, kernel } = await harness();
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
await _afterEachFixture0();
}
});
}

{

const { seedWorld } = createSeededDashboardWorld();


const worlds: DashboardWorld[] = [];

async function world(...args: Parameters<typeof makeWorld>): Promise<DashboardWorld> {
  const created = await makeWorld(...args);
  worlds.push(created);
  return created;
}

const _afterEachFixture0 = async () => {
  for (const w of worlds.splice(0)) await w.dispose();
};

describe("THE run/queue projection", () => {
afterEach(_afterEachFixture0);

  it("folds the seeded world into one payload whose three count renderings agree by construction", async () => {
    const w = await world();
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

  it("the wire refuses a gate instant on a row that is not waiting", async () => {
    const w = await world();
    seedWorld(w);
    const running = rowOf(w, 2);
    assert.equal(QueueSurfaceWireSchema.safeParse({
      ...running,
      gateOpenedAt: { state: "present", value: "2026-08-03T17:05:00.000Z" },
    }).success, false);
  });
});
}
