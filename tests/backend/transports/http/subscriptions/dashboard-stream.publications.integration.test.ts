import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { createNotificationInbox, type NotificationPublication } from "../../../../../src/backend/runs/notifications/inbox.js";
import { NotificationPublicationWireSchema, type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { notificationWireOf, notificationSourceEventOf } from "../../../../../src/models/dashboard/projection.js";
import { ActorIdSchema } from "../../../../../src/rules/identity/ids.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { DAY, makeWorld, queuedEventOf, type DashboardWorld } from "../../../../support/helpers/backend/dashboard-harness.js";
import { sseSerialize } from "../../../../../src/backend/transports/http/subscriptions/sse-response.js";

const worlds: DashboardWorld[] = [], hubs: DashboardStreamHub[] = [];
afterEach(async () => { for (const hub of hubs.splice(0)) hub.close(); for (const world of worlds.splice(0)) await world.dispose(); });
const STORAGE_TARGET = { kind: "storage" } as const;
const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
async function setup(options: Readonly<{ retention?: number; maxPending?: number }> = {}) {
  const world = await makeWorld(); worlds.push(world);
  const inbox = createNotificationInbox({ authority: world.database, clock: world.clock, ids: sequentialIdFactory("f"), runReader: world.runReader, actorId: "local-operator" });
  const projected: NotificationPublication[] = [];
  let listener: ((publication: NotificationPublication) => void) | undefined;
  const hub = createDashboardStreamHub({ projection: world.projection, maxPending: options.maxPending ?? 2, retention: options.retention ?? 1,
    backfillGaps: { detected: async input => { await inbox.publish(event); return { published: false, gap: BackfillGapObservationSchema.parse(input) }; } },
    notificationPublications: { subscribe: callback => { listener = callback; const close = inbox.onPublication(callback); return () => { listener = undefined; close(); }; }, project: publication => {
      projected.push(publication);
      const wire = NotificationPublicationWireSchema.parse({ sourceId: publication.sourceId, actorId: publication.notification.actorId, durable: publication.durable,
        notification: notificationWireOf(publication.notification, world.clock.nowMs(), { state: "not-applicable" }, notificationSourceEventOf(publication.notification, { actorId: publication.notification.actorId, notificationId: publication.notification.notificationId, event: publication.event, adopted: false })) });
      return { publication: wire, listed: wire.notification };
    }, target: () => STORAGE_TARGET },
  }); hubs.push(hub);
  return { world, inbox, hub, projected, broadcast: (publication: NotificationPublication) => listener?.(publication) };
}
it("delivers committed publications at their own cursor with their target; a baseline or a resume at the head replays none", async () => {
  const { world, inbox, hub } = await setup();
  await inbox.publish(event);
  const connection = await hub.connect({ day: DAY });
  assert.equal(connection.initial.some(envelope => envelope.type === "notification-publication"), false);
  await inbox.publish(event);
  assert.equal(connection.pending, 0);
  await inbox.publish(event, { identity: "b".repeat(64), occurredAt: world.clock.now().toISOString() });
  assert.equal(connection.pending, 1);
  const publication = await connection.next(); assert(publication?.type === "notification-publication");
  assert.equal(publication.day, DAY);
  assert.equal(publication.publication.durable, "folded");
  assert.equal(publication.publication.notification.sourceEvent?.state, "available");
  assert.equal(publication.descriptorHash, world.projection.descriptorSetHash());
  assert.equal(publication.projectionGeneration, world.projection.generation());
  assert.deepEqual(publication.target, STORAGE_TARGET);
  assert.equal(publication.cursor, world.projection.cursor());
  assert.equal(sseSerialize(publication).startsWith(`id: ${publication.cursor}`), true);
  connection.close();
  const reconnect = await hub.connect({ day: DAY, lastEventId: world.projection.cursor(), lastProjectionGeneration: world.projection.generation() });
  assert.equal(reconnect.initial.some(envelope => envelope.type === "notification-publication"), false);
  assert.equal(reconnect.pending, 0);
  reconnect.close();
  const resnapshot = await hub.connect({ day: DAY });
  assert.equal(resnapshot.initial.some(envelope => envelope.type === "notification-publication"), false);
  assert.equal(resnapshot.pending, 0);
});
it("carries snooze from committed state and excludes notifications for another actor", async () => {
  const { world, inbox, hub, projected, broadcast } = await setup();
  const first = await inbox.publish(event);
  const connection = await hub.connect({ day: DAY });
  let pending: ReturnType<typeof inbox.publish> | undefined;
  world.database.withAuthorityTransaction(() => {
    pending = inbox.publish(event, { identity: "c".repeat(64), occurredAt: world.clock.now().toISOString() });
    const current = inbox.get(first.notification.notificationId); assert(current);
    inbox.snooze(current.notificationId, current.version, "2026-09-15T12:00:00Z");
  });
  await pending;
  const publication = await connection.next(); assert(publication?.type === "notification-publication");
  assert.equal(publication.publication.notification.state, "snoozed");
  assert.equal(connection.pending, 0);
  broadcast({ ...projected[0], notification: { ...projected[0].notification, actorId: ActorIdSchema.parse("other-operator") } });
  assert.equal(connection.pending, 0);
  connection.close();
});
it("uses existing bounded backpressure and removes its publication listener on close", async () => {
  const { world, inbox, hub, projected } = await setup();
  const connection = await hub.connect({ day: DAY });
  for (const identity of ["b", "c", "d"]) await inbox.publish(event, { identity: identity.repeat(64), occurredAt: world.clock.now().toISOString() });
  assert.equal(connection.pending, 1);
  assert.equal((await connection.next())?.type, "reset-required");
  const count = projected.length;
  hub.close();
  await inbox.publish(event, { identity: "e".repeat(64), occurredAt: world.clock.now().toISOString() });
  assert.equal(projected.length, count);
  assert.equal(await connection.next(), undefined);
});

it("does not attach the subscriber until snapshot construction has finished", async () => {
  const { world, inbox, hub } = await setup();
  const build = world.projection.buildDashboardDayWire.bind(world.projection);
  let pending: ReturnType<typeof inbox.publish> | undefined;
  const spy = vi.spyOn(world.projection, "buildDashboardDayWire").mockImplementationOnce(day => {
    pending = inbox.publish(event);
    return build(day);
  });
  const connection = await hub.connect({ day: DAY });
  await pending;
  assert.equal(connection.pending, 0);
  assert.equal(connection.initial.some(envelope => envelope.type === "notification-publication"), false);
  spy.mockRestore();
});

it("excludes publications made by backfill detection from the connecting subscriber", async () => {
  const { world, hub } = await setup();
  queuedEventOf(world, { seed: 1 });
  const first = await hub.connect({ day: DAY });
  const lastEventId = world.projection.cursor(), lastProjectionGeneration = world.projection.generation();
  first.close();
  queuedEventOf(world, { seed: 2 }); queuedEventOf(world, { seed: 3 });
  const reconnected = await hub.connect({ day: DAY, lastEventId, lastProjectionGeneration });
  assert.equal(reconnected.initial.some(envelope => envelope.type === "notification-publication"), false);
  assert.equal(reconnected.pending, 0);
  assert.equal(world.database.authority.notificationPublications.list().length, 1);
});
it("keeps verified completion publications eligible despite the legacy no-channel report", async () => {
  const { world, inbox, hub } = await setup();
  const run = queuedEventOf(world, { seed: 1 });
  const connection = await hub.connect({ day: DAY });
  const report = await inbox.publish({ kind: "verified-done", runId: run.runId, workflowId: "person-lookup" });
  assert.equal(report.delivery.state, "no-channel");
  const publication = await connection.next(); assert(publication?.type === "notification-publication");
  assert.equal(publication.publication.notification.sourceEvent?.state, "available");
  assert.equal(publication.publication.notification.channel, "inbox");
});

/** `type`, and the cursor and source of a publication, for the order a connection is answered in. */
const shapeOf = (envelope: DashboardStreamEnvelope): string => envelope.type === "notification-publication"
  ? `publication ${envelope.cursor} ${envelope.publication.sourceId.slice(0, 1)}` : envelope.type === "health" ? `health ${envelope.state}` : envelope.type;

it("replays the publications above a resumed cursor after health: live, then hands off at a new cursor (section 5 example)", async () => {
  const { world, inbox, hub } = await setup({ retention: 256, maxPending: 64 });
  const first = await hub.connect({ day: DAY });
  const held = world.projection.cursor();
  assert.equal(first.initial.at(-1)?.type, "health");
  await inbox.publish(event, { identity: "1".repeat(64), occurredAt: world.clock.now().toISOString() });
  const s1 = await first.next(); assert(s1?.type === "notification-publication");
  first.close();
  await inbox.publish(event, { identity: "2".repeat(64), occurredAt: world.clock.now().toISOString() });
  const s2Cursor = world.projection.cursor();

  const resumed = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: world.projection.generation() });

  const sourceOf = (envelope: DashboardStreamEnvelope | undefined) => envelope?.type === "notification-publication" ? envelope.publication.sourceId : undefined;
  const replayed = resumed.initial.filter(envelope => envelope.type === "notification-publication");
  assert.deepEqual(resumed.initial.map(envelope => envelope.type), ["hello", "health", "notification-publication", "notification-publication", "change"]);
  assert.deepEqual(resumed.initial[1], { type: "health", state: "live" });
  assert(replayed[0]?.type === "notification-publication" && replayed[1]?.type === "notification-publication");
  assert.equal(replayed[0].cursor, s1.cursor, "the replay keeps the publication's cursor");
  assert.equal(sourceOf(replayed[0]), s1.publication.sourceId);
  assert.deepEqual(replayed[0].target, s1.target, "and its target");
  assert.deepEqual(replayed[0].listed, s1.listed);
  assert.equal(replayed[1].cursor, s2Cursor);
  const handoff = resumed.initial[4]; assert(handoff?.type === "change");
  assert.equal(handoff.after, held, "the handoff follows the presented cursor; publications do not move it");
  assert.equal(handoff.day, undefined);
  assert(Number(handoff.cursor.slice(3)) > Number(s2Cursor.slice(3)));
  resumed.close();
});

it("answers a fresh connect with its snapshot before health: live and replays no publication", async () => {
  const { inbox, hub, world } = await setup({ retention: 256, maxPending: 64 });
  await inbox.publish(event, { identity: "1".repeat(64), occurredAt: world.clock.now().toISOString() });
  const connection = await hub.connect({ day: DAY });
  assert.deepEqual(connection.initial.map(shapeOf), ["hello", "snapshot", "health live"]);
  connection.close();
});

it("turns a resume below an evicted publication into a snapshot", async () => {
  const { world, inbox, hub } = await setup({ retention: 1, maxPending: 64 });
  const first = await hub.connect({ day: DAY });
  const held = world.projection.cursor();
  first.close();
  for (const identity of ["1", "2"]) await inbox.publish(event, { identity: identity.repeat(64), occurredAt: world.clock.now().toISOString() });
  const resumed = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: world.projection.generation() });
  assert.deepEqual(resumed.initial.map(shapeOf), ["hello", "snapshot", "health live"]);
  resumed.close();
});
