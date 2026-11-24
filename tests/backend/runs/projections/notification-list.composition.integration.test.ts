import assert from "node:assert/strict";
import { Hono } from "hono";
import { z } from "zod";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { NotificationWireSchema } from "../../../../src/models/dashboard/projection.js";
import { registerNotificationRoutes } from "../../../../src/backend/transports/http/routes/notifications.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import { DAY, DESCRIPTOR_SET_HASH, notificationRecordOf, queuedEventOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { composeNotificationPublications, composeNotificationRoutes } from "../../../../src/backend/app/composition/dashboard/notification-wiring.js";
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

it("serves the same storage group through canonical inbox and day snapshots, keeping publications individual", async () => {
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
    assert.deepEqual(queue.buildDashboardDayWire(DAY).notifications, rows);
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

    const linked = queuedEventOf(w, { seed: 1, descriptor: personLookupDescriptor, displayName: "First name" });
    await inbox.publish({ kind: "verified-done", runId: linked.runId, workflowId: "person-lookup" });
    const done = emitted.at(-1);
    assert.ok(done !== undefined && done.event.kind === "verified-done");
    const plain = publications.project(done);
    assert.deepEqual(plain.listed, plain.publication.notification, "a publication outside a group is listed as itself");
    const notice = notificationRecordOf({ seed: 1, title: "Run needs attention", lastSeenAt: linked.ts });
    database.authority.notifications.create(notice);
    const subject = async (response: Response) => {
      assert.equal(response.status, 200);
      const row = z.array(NotificationWireSchema).parse(await response.json()).find(row => row.notificationId === notice.notificationId);
      assert.ok(row?.kind === "notification" && row.context.state === "available");
      return row.context.subject;
    };
    const beforeRename = await read();
    assert.equal(await subject(beforeRename), "First name");
    const linkedTag = beforeRename.headers.get("ETag");
    assert.ok(linkedTag);
    assert.equal(database.authority.runs.updatePresentation({ runId: linked.runId, displayName: "Second name",
      expectedVersion: 1, now: clock.now().toISOString() }).state, "applied");
    assert.equal(await subject(await read(linkedTag)), "Second name");
  } finally {
    unsubscribe();
    await observer.stop();
  }
});
