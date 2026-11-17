import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { DAY, instantOffsetOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { NotificationWireSchema } from "../../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { projectNotificationTrigger, type NotificationTriggerEvent } from "../../../../src/rules/notifications/notification-triggers.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const { world, cleanup, queuedEventOf } = createRunQueueProjectionTestWorld(profiles.create);
afterEach(cleanup);

function recordOf(event: NotificationTriggerEvent, seed: number, count = 1) {
  const at = instantOffsetOf(0, seed * 1000);
  return NotificationRecordSchema.parse({ ...projectNotificationTrigger(event),
    notificationId: uuidOf(7000 + seed), actorId: "local-operator", status: "unread",
    snooze: { state: "not-snoozed" }, count, version: seed,
    createdAt: instantOffsetOf(0), updatedAt: at, lastSeenAt: at });
}

it("groups five source-proven storage problems by concern with exact control membership", async () => {
  const w = await world();
  const events = [1, 2, 3, 4, 5].map(seed => ({ kind: "storage-degraded", concern: "backup", state: "failed",
    diagnosticFingerprint: String(seed).repeat(64) } as const));
  const records = events.map((event, index) => recordOf(event, index + 1));
  w.authority.notifications.push(...records);
  Object.assign(w.authority, { latestNotificationSource: (id: string) => {
    const index = records.findIndex(record => record.notificationId === id);
    return { actorId: "local-operator", notificationId: id, adopted: false, event: events[index] };
  } });
  const rows = w.projection.buildDashboardDayWire(DAY).notifications;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 5);
  assert.equal(rows[0].occurredAt, instantOffsetOf(0, 5000));
  assert.ok(rows[0].kind === "notification");
  assert.deepEqual(rows[0].context, { state: "storage", concern: "backup" });
  assert.deepEqual(rows[0].group, { concern: "backup", members: records.map(record => ({
    notificationId: record.notificationId, revision: record.version })) });
  assert.deepEqual(w.authority.notifications, records);
  const group = rows[0].group;
  assert.ok(group);
  for (const invalid of [
    { ...rows[0], group: { ...group, members: [group.members[0], group.members[0]] } },
    { ...rows[0], group: { ...group, members: group.members.slice(0, 4) } },
    { ...rows[0], group: { ...group, concern: "disk-space" } },
    { ...rows[0], sourceEvent: { state: "unavailable" } },
    { ...rows[0], group: { ...group, members: group.members.map(member => ({ ...member, extra: true })) } },
  ]) assert.equal(NotificationWireSchema.safeParse(invalid).success, false);
});

it("leaves source-unavailable storage rows separate with explicitly unavailable context", async () => {
  const w = await world();
  const event = { kind: "storage-degraded", concern: "backup", state: "failed", diagnosticFingerprint: "a".repeat(64) } as const;
  w.authority.notifications.push(recordOf(event, 1), recordOf(event, 2));
  const rows = w.projection.buildDashboardDayWire(DAY).notifications;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.kind === "notification");
    assert.deepEqual(row.context, { state: "unavailable" });
    assert.deepEqual(row.sourceEvent, { state: "unavailable" });
    assert.equal(row.group, undefined);
  }
});

it("serves retained failed-run context and evidence, and preserves unavailable context for a missing run", async () => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  queuedEventOf(w, { seed: 1, descriptor: personLookupDescriptor });
  const run = w.authority.getRun(uuidOf(1));
  assert.ok(run);
  w.authority.put({ ...run, displayName: "Example Person" });
  const event = { kind: "run-failed", runId: uuidOf(1), workflowId: "person-lookup", failureId: uuidOf(501),
    failureFingerprint: "f".repeat(64), code: "SYSTEM_UNAVAILABLE" } as const;
  const record = recordOf(event, 1);
  w.authority.notifications.push(record);
  Object.assign(w.authority, { latestNotificationSource: () => ({ actorId: record.actorId,
    notificationId: record.notificationId, adopted: false, event }) });
  const row = w.projection.buildDashboardDayWire(DAY).notifications[0];
  assert.ok(row.kind === "notification");
  assert.deepEqual(row.context, { state: "available", workflow: personLookupDescriptor.label, subject: "Example Person" });
  assert.deepEqual(row.sourceEvent, { state: "available", kind: "run-failed" });
  assert.deepEqual(row.link, { kind: "failure", runId: uuidOf(1), failureId: uuidOf(501) });
  w.authority.records.delete(uuidOf(1));
  const missing = w.projection.buildDashboardDayWire(DAY).notifications[0];
  assert.ok(missing.kind === "notification");
  assert.deepEqual(missing.context, { state: "unavailable" });
  assert.deepEqual(missing.sourceEvent, { state: "available", kind: "run-failed" });
});

it("sums folded counts without mixing concerns and rejects mismatched source ownership", async () => {
  const w = await world();
  const events = [
    { kind: "storage-degraded", concern: "backup", state: "failed", diagnosticFingerprint: "a".repeat(64) },
    { kind: "storage-degraded", concern: "backup", state: "degraded", diagnosticFingerprint: "b".repeat(64) },
    { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "c".repeat(64) },
  ] as const;
  const records = events.map((event, index) => recordOf(event, index + 1, index === 0 ? 2 : 3));
  w.authority.notifications.push(...records);
  let wrongOwner = false;
  Object.assign(w.authority, { latestNotificationSource: (id: string) => ({ actorId: wrongOwner ? "another-actor" : "local-operator",
    notificationId: id, adopted: false, event: events[records.findIndex(record => record.notificationId === id)] }) });
  const rows = w.projection.buildDashboardDayWire(DAY).notifications;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].count, 3);
  assert.equal(rows[1].count, 5);
  assert.ok(rows[1].kind === "notification");
  assert.equal(rows[1].group?.concern, "backup");
  const publicationId = rows[1].publicationId;
  w.authority.notifications.reverse();
  assert.deepEqual(w.projection.buildDashboardDayWire(DAY).notifications, rows);
  w.authority.notifications[0] = NotificationRecordSchema.parse({ ...w.authority.notifications[0], version: 9 });
  assert.equal(w.projection.buildDashboardDayWire(DAY).notifications[1].publicationId, publicationId);
  wrongOwner = true;
  assert.throws(() => w.projection.buildDashboardDayWire(DAY), /NOTIFICATION_PUBLICATION_OWNER_MISMATCH/);
});

it("keeps publication identity across controls and snoozes a group only while every member is snoozed", async () => {
  const w = await world();
  const events = [1, 2].map(seed => ({ kind: "storage-degraded", concern: "backup", state: "failed",
    diagnosticFingerprint: String(seed).repeat(64) } as const));
  const records = events.map((event, index) => recordOf(event, index + 1));
  w.authority.notifications.push(records[0], NotificationRecordSchema.parse({ ...records[1], status: "read",
    snooze: { state: "snoozed", until: instantOffsetOf(0, 120000) } }));
  Object.assign(w.authority, { latestNotificationSource: (id: string) => ({ actorId: "local-operator",
    notificationId: id, adopted: false, event: events[records.findIndex(record => record.notificationId === id)] }) });
  const before = w.projection.buildDashboardDayWire(DAY).notifications[0];
  assert.ok(before.kind === "notification");
  assert.equal(before.state, "unread");
  assert.equal(before.snoozedUntil, undefined);
  w.authority.notifications[0] = NotificationRecordSchema.parse({ ...records[0], version: 10, status: "read",
    snooze: { state: "snoozed", until: instantOffsetOf(0, 60000) } });
  const snoozed = w.projection.buildDashboardDayWire(DAY).notifications[0];
  assert.ok(snoozed.kind === "notification");
  assert.equal(snoozed.state, "snoozed");
  assert.equal(snoozed.readState, "read");
  assert.equal(snoozed.snoozedUntil, instantOffsetOf(0, 60000));
  assert.deepEqual(snoozed.group?.members, [
    { notificationId: records[0].notificationId, revision: 10 },
    { notificationId: records[1].notificationId, revision: 2 },
  ]);
  assert.equal(snoozed.publicationId, before.publicationId);
  w.clock.advanceWall(61000);
  const expired = w.projection.buildDashboardDayWire(DAY).notifications[0];
  assert.ok(expired.kind === "notification");
  assert.equal(expired.state, "read");
  assert.equal(expired.snoozedUntil, undefined);
  assert.equal(expired.publicationId, before.publicationId);
});
