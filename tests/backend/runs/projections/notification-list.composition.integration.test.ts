import assert from "node:assert/strict";
import { Hono } from "hono";
import { z } from "zod";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { ActorIdSchema, CommandIdSchema } from "../../../../src/rules/identity/ids.js";
import { NotificationWireSchema } from "../../../../src/models/dashboard/projection.js";
import { registerNotificationRoutes } from "../../../../src/backend/transports/http/routes/notifications.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { afterAll, afterEach, it, vi } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import { createDashboardStreamHub } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { registerQueueRoutes } from "../../../../src/backend/transports/http/routes/queue.js";
import { DAY, DESCRIPTOR_SET_HASH, notificationRecordOf, queuedEventOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { composeNotificationPublications, composeNotificationReads, composeNotificationRoutes } from "../../../../src/backend/app/composition/dashboard/notification-wiring.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { createNotificationObserver } from "../../../../src/backend/runs/notifications/observation.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import type { NotificationPublication } from "../../../../src/backend/runs/notifications/inbox.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const { world, cleanup } = createRunQueueProjectionTestWorld(profiles.create);
afterEach(cleanup);

it("serves the same storage group through the inbox route and stream row, keeping publications individual", async () => {
  const w = await world();
  const { database, clock } = w;
  let seed = 100;
  const ids = { uuid: () => uuidOf(++seed) };
  const lifecycle = new RunRecordService({ database, clock, ids, publishQueued: () => undefined });
  const descriptors = { resolve: () => personLookupDescriptor };
  const inbox = createNotificationInbox({ authority: database, clock, ids, actorId: "local-operator" });
  const observer = {
    ...createNotificationObserver({ inbox, read: () => ({ observations: [], diagnostics: [] }), health: async () => undefined }),
    healthDueAt: () => Infinity,
  };
  const input = { database, clock, lifecycle, descriptors, runDetailDeps: createRunDetailTestWorld().depsOf(w) };
  const routes = composeNotificationRoutes({ ...input, assertCurrent: () => undefined, notificationObserver: observer,
    notificationTarget: () => ({ kind: "storage" }) });
  const publications = composeNotificationPublications({ ...input, notificationInbox: inbox, target: routes.target });
  const emitted: NotificationPublication[] = [];
  const unsubscribe = publications.subscribe(publication => emitted.push(publication));
  try {
    for (let index = 1; index <= 5; index++) {
      clock.advanceWall(1000);
      await inbox.publish({ kind: "storage-degraded", concern: "backup", state: "failed", diagnosticFingerprint: String(index).repeat(64) });
    }
    const app: DashboardApp = new Hono();
    let actor = "local-operator";
    app.use("*", async (c, next) => { c.set("requestActorId", ActorIdSchema.parse(actor)); await next(); });
    registerNotificationRoutes(app, { notifications: routes });
    const read = (tag?: string) => app.request("/api/v1/notifications", tag ? { headers: { "If-None-Match": tag } } : {});
    const first = await read();
    const tag = first.headers.get("ETag");
    assert.ok(tag);
    const original = z.array(NotificationWireSchema).parse(await first.json());
    const debug = createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: "0.1.0" });
    assert.equal(debug.emit({ category: "boot", phase: "failed", correlationId: ids.uuid(),
      area: "integration", reason: "unrelated-timeline-write" }).state, "inserted");
    const repeat = await read(tag);
    assert.equal(repeat.status, 304);
    assert.equal(await repeat.text(), "");
    actor = "other-operator";
    const other = await read(tag);
    assert.equal(other.status, 200);
    assert.deepEqual(await other.json(), []);
    actor = "local-operator";
    const rows = routes.snapshot("local-operator");
    assert.deepEqual(original, rows);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 5);
    assert.ok(rows[0].kind === "notification");
    assert.deepEqual(rows[0].context, { state: "storage", concern: "backup" });
    assert.equal(rows[0].group?.members.length, 5);
    const queue = createOperatorProjection({ database, reader: lifecycle, clock, stateRoot: w.stateRoot,
      appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, ledger: createTransactionHistory(database.authority), descriptors });
    const unexpected = (): never => { throw new Error("unexpected start plan"); };
    const queueApp: DashboardApp = new Hono();
    registerQueueRoutes(queueApp, { queue: { day: day => queue.servedDashboardDay(day) },
      startPlans: { plan: unexpected, previewWarnings: unexpected } });
    const dayResponse = await queueApp.request(`/api/v1/dashboard?day=${DAY}`);
    assert.equal(dayResponse.status, 200);
    const dayPayload: unknown = await dayResponse.json();
    assert.ok(dayPayload !== null && typeof dayPayload === "object");
    assert.equal(Object.hasOwn(dayPayload, "notifications"), false);
    const hub = createDashboardStreamHub({ projection: queue, notificationList: routes.streamList, notificationPublications: publications,
      backfillGaps: { detected: () => Promise.reject(new Error("unexpected gap")) } });
    try {
      const connection = await hub.connect({ day: DAY });
      const handoff = connection.initial.find(envelope => envelope.type === "snapshot");
      assert.ok(handoff);
      assert.equal(Object.hasOwn(handoff.payload, "notifications"), false);
      assert.deepEqual(handoff.rows.find(row => row.model === "notification-list")?.value, { state: "available", value: rows });
      connection.close();
    } finally {
      hub.close();
    }
    assert.equal(emitted.length, 5);
    for (const publication of emitted) {
      const { publication: wire, listed } = publications.project(publication);
      const row = wire.notification;
      assert.deepEqual(listed, rows[0], "a storage publication is listed inside its concern's one group row");
      assert.ok(listed.kind === "notification" && listed.count === 5);
      assert.deepEqual(publications.target(publication), { kind: "storage" });
      assert.ok(row.kind === "notification");
      assert.deepEqual(row.context, { state: "storage", concern: "backup" });
      assert.equal(row.group, undefined);
      assert.equal(row.count, 1);
    }
    const members = database.authority.notifications.listByActor(actor);
    assert.equal(members.length, 5);
    const now = clock.nowMs();
    const current = await read();
    const currentTag = current.headers.get("ETag");
    assert.ok(currentTag);
    for (const [index, member] of members.entries()) {
      inbox.snooze(member.notificationId, member.version, new Date(now + (index + 1) * 1000).toISOString());
    }
    const snoozed = await read(currentTag);
    assert.equal(snoozed.status, 200);
    const groupState = async (response: Response) => z.array(NotificationWireSchema).parse(await response.json())[0].state;
    assert.equal(await groupState(snoozed), "snoozed");
    const snoozedTag = snoozed.headers.get("ETag");
    assert.ok(snoozedTag);
    assert.equal((await read(snoozedTag)).status, 304);
    clock.advanceWall(1000);
    const expired = await read(snoozedTag);
    assert.equal(expired.status, 200);
    assert.equal(await groupState(expired), "unread");
    const expiredTag = expired.headers.get("ETag");
    assert.ok(expiredTag);
    clock.setWall(new Date(now));
    assert.equal(await groupState(await read(expiredTag)), "snoozed");

    const linked = queuedEventOf(w, { seed: 1, descriptor: { ...personLookupDescriptor, version: personLookupDescriptor.version - 1 }, displayName: "First name" });
    const otherRun = queuedEventOf(w, { seed: 2, descriptor: personLookupDescriptor });
    const appendEvidence = ({ workflow, runId, traceId, attempt, ts }: typeof linked) => {
      w.writer.emit({ t: "transaction.fenced", ts, workflow, runId, traceId, attempt,
        spanPath: `${traceId}/removed-node/commit`, node: "removed-node", taskId: "ucpath/search-person-org" });
    };
    await inbox.publish({ kind: "command-unknown", commandId: CommandIdSchema.parse(uuidOf(900)) });
    const done = emitted.at(-1);
    assert.ok(done !== undefined && done.event.kind === "command-unknown");
    const plain = publications.project(done);
    assert.deepEqual(plain.listed, plain.publication.notification, "a publication outside a group is listed as itself");
    const unlisted = { ...done, notification: { ...done.notification, notificationId: uuidOf(901) } } as NotificationPublication;
    assert.throws(() => publications.project(unlisted), /NOTIFICATION_PUBLICATION_NOT_LISTED/u, "a publication its actor's list does not hold is a named failure");
    const notice = notificationRecordOf({ seed: 1, title: "Run needs attention", lastSeenAt: linked.ts });
    database.authority.notifications.create(notice);
    const context = async (response: Response) => {
      assert.equal(response.status, 200);
      const row = z.array(NotificationWireSchema).parse(await response.json()).find(row => row.notificationId === notice.notificationId);
      assert.ok(row?.kind === "notification");
      return row.context;
    };
    const resolve = vi.spyOn(descriptors, "resolve");
    const beforeRename = await read();
    const beforeContext = { state: "available", workflow: personLookupDescriptor.label, subject: "First name" };
    assert.deepEqual(await context(beforeRename), beforeContext);
    const linkedTag = beforeRename.headers.get("ETag");
    assert.ok(linkedTag);
    assert.deepEqual(await context(await read()), beforeContext);
    assert.equal(resolve.mock.calls.length, 1, "an unchanged list reuses the linked display projection");
    appendEvidence(otherRun);
    assert.equal((await read(linkedTag)).status, 304);
    assert.equal(resolve.mock.calls.length, 1, "another run's evidence keeps the linked display projection warm");
    await inbox.publish({ kind: "command-unknown", commandId: CommandIdSchema.parse(uuidOf(902)) });
    const unrelated = emitted.at(-1);
    assert.ok(unrelated);
    publications.project(unrelated);
    assert.equal(resolve.mock.calls.length, 1, "projecting one arrival never reads another notice's run");
    assert.equal(database.authority.runs.updatePresentation({ runId: linked.runId, displayName: "Second name",
      expectedVersion: 1, now: clock.now().toISOString() }).state, "applied");
    const renamed = await read(linkedTag);
    assert.deepEqual(await context(renamed), { ...beforeContext, subject: "Second name" });
    const renamedTag = renamed.headers.get("ETag");
    assert.ok(renamedTag);
    appendEvidence(linked);
    assert.deepEqual(await context(await read(renamedTag)), { state: "workflow-only", workflow: personLookupDescriptor.label });
  } finally {
    unsubscribe();
    await observer.stop();
  }
});

it("refreshes a streamed storage notice when only its concern's health clears", async () => {
  const w = await world();
  const { database, clock } = w;
  let seed = 300;
  const ids = { uuid: () => uuidOf(++seed) };
  const lifecycle = new RunRecordService({ database, clock, ids, publishQueued: () => undefined });
  const descriptors = { resolve: () => personLookupDescriptor };
  const inbox = createNotificationInbox({ authority: database, clock, ids, actorId: "local-operator" });
  const health = (active: boolean) => {
    const at = clock.now().toISOString();
    database.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active, occurrence: active ? 1 : 0, observedAt: at, createdAt: at, samples: [] }));
  };
  health(true);
  await inbox.publish({ kind: "storage-degraded", concern: "disk-space", state: "failed", diagnosticFingerprint: "a".repeat(64) });
  const observer = {
    ...createNotificationObserver({ inbox, read: () => ({ observations: [], diagnostics: [] }), health: async () => undefined }),
    healthDueAt: () => Infinity,
  };
  const reads = composeNotificationReads(database);
  let listFailed = false;
  const reportListReadFailure = vi.fn();
  const routes = composeNotificationRoutes({ database, clock, lifecycle, descriptors, runDetailDeps: createRunDetailTestWorld().depsOf(w),
    assertCurrent: () => undefined, notificationObserver: observer, notificationTarget: () => ({ kind: "storage" }), reportListReadFailure,
    notificationReads: { ...reads, list: actor => {
      if (listFailed) throw new Error("synthetic inbox read failure");
      return reads.list(actor);
    } } });
  const hub = createDashboardStreamHub({ projection: w.projection, notificationList: routes.streamList,
    backfillGaps: { detected: () => Promise.reject(new Error("unexpected gap")) } });
  try {
    const connection = await hub.connect({ day: DAY });
    const standing = (envelope: typeof connection.initial[number] | undefined) => {
      assert.ok(envelope?.type === "snapshot" || envelope?.type === "change");
      const list = envelope.rows.find(row => row.model === "notification-list");
      assert.ok(list?.value.state === "available");
      return list.value.value.map(row => row.kind !== "backfill-gap" && row.standing === true);
    };
    assert.deepEqual(standing(connection.initial.find(envelope => envelope.type === "snapshot")), [true]);
    clock.advanceWall(1000);
    health(false);
    assert.equal(routes.snapshot("local-operator")[0].kind, "notification", "a GET may read the new state before the stream polls");
    await routes.pollList();
    assert.equal(connection.pending, 1);
    const change = await connection.next();
    assert.ok(change?.type === "change" && change.day === undefined);
    assert.deepEqual(standing(change), [false]);

    health(true);
    listFailed = true;
    await routes.pollList();
    assert.equal(reportListReadFailure.mock.calls.length, 1);
    const unavailable = await connection.next();
    assert.ok(unavailable?.type === "change");
    assert.equal(unavailable.rows.find(row => row.model === "notification-list")?.value.state, "unavailable");
    listFailed = false;
    await routes.pollList();
    assert.deepEqual(standing(await connection.next()), [true]);
    connection.close();
  } finally {
    hub.close();
    await observer.stop();
  }
});
