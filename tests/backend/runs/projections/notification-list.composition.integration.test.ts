import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import { DAY, DESCRIPTOR_SET_HASH, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
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
  const observer = createNotificationObserver({ inbox, read: () => ({ observations: [], diagnostics: [] }), health: async () => undefined });
  const input = { database, clock, lifecycle, descriptors, runDetailDeps: createRunDetailTestWorld().depsOf(w) };
  const routes = composeNotificationRoutes({ ...input, assertCurrent: () => undefined, notificationObserver: observer,
    notificationTarget: () => ({ kind: "storage" }) });
  const publications = composeNotificationPublications({ ...input, notificationInbox: inbox });
  const emitted: NotificationPublication[] = [];
  const unsubscribe = publications.subscribe(publication => emitted.push(publication));
  try {
    for (let index = 1; index <= 5; index++) {
      clock.advanceWall(1000);
      await inbox.publish({ kind: "storage-degraded", concern: "backup", state: "failed", diagnosticFingerprint: String(index).repeat(64) });
    }
    const rows = routes.snapshot("local-operator");
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
      const row = publications.project(publication).notification;
      assert.ok(row.kind === "notification");
      assert.deepEqual(row.context, { state: "storage", concern: "backup" });
      assert.equal(row.group, undefined);
      assert.equal(row.count, 1);
    }
    assert.equal(database.authority.notifications.listByActor("local-operator").length, 5);
  } finally {
    unsubscribe();
    await observer.stop();
  }
});
