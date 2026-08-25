/**
 * Track F A46: an unreplayable dashboard cursor is a notification-history gap,
 * not a disconnect guess. The event is closed protocol evidence and projects
 * to one linkless durable safety record.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/domain/ids.js";
import {
  NotificationTriggerEventSchema,
  projectNotificationTrigger,
} from "../../src/domain/notification-triggers.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { createDashboardStreamHub } from "../../src/server/dashboard/subscriptions/dashboard-stream.js";
import { createBackfillGapNotifier } from "../../src/services/notifications/backfill-gap.js";
import { createNotificationInbox } from "../../src/services/notifications/inbox.js";
import { NOW } from "./fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  DAY,
  makeWorld as makeDashboardWorld,
  queuedEventOf,
} from "./server/helpers/dashboard-harness.js";

const GAP = {
  kind: "backfill-gap",
  detector: "server-resume",
  reason: "cursor-expired",
  topic: "dashboard-day",
  requestedCursor: "pc:4",
  currentCursor: "pc:12",
  projectionGeneration: 3,
} as const;

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function world() {
  const root = mkdtempSync(join(tmpdir(), "hrauto-backfill-gap-"));
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "backfill-gap-test" },
    clock,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const inbox = createNotificationInbox({
    authority: database,
    clock,
    ids: sequentialIdFactory("b"),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });
  return { inbox };
}

describe("backfill-gap notification", () => {
  it("projects closed cursor evidence to one linkless pinned trigger", () => {
    const event = NotificationTriggerEventSchema.parse(GAP);

    const projection = projectNotificationTrigger(event);

    assert.equal(projection.trigger, "backfill-gap");
    assert.equal(projection.channel, "ping");
    assert.deepEqual(projection.links, []);
    assert.equal(projection.title, "Notification history is incomplete");
  });

  it("refuses timeout guesses and free text at the gap-event boundary", () => {
    assert.equal(
      NotificationTriggerEventSchema.safeParse({ ...GAP, reason: "timeout" }).success,
      false,
    );
    assert.equal(
      NotificationTriggerEventSchema.safeParse({ ...GAP, detail: "subject 12345678" }).success,
      false,
    );
    assert.equal(
      NotificationTriggerEventSchema.safeParse({ ...GAP, requestedCursor: GAP.currentCursor }).success,
      false,
    );
  });

  it("publishes one durable record for repeated detection of the same gap", async () => {
    const { inbox } = world();
    const notifier = createBackfillGapNotifier({ inbox });

    await notifier.detected(GAP);
    await notifier.detected(GAP);

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.trigger, "backfill-gap");
    assert.equal(rows[0]?.count, 1);
    assert.equal(rows[0]?.version, 1);
  });

  it("keeps one identity when the same stale cursor is retried after the head advances", async () => {
    const { inbox } = world();
    const notifier = createBackfillGapNotifier({ inbox });

    await notifier.detected(GAP);
    await notifier.detected({ ...GAP, currentCursor: "pc:13" });

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.count, 1);
    assert.equal(rows[0]?.version, 1);
  });

  it("retries the same gap after a publisher failure instead of forgetting it", async () => {
    const { inbox } = world();
    let failures = 1;
    const notifier = createBackfillGapNotifier({
      inbox: {
        publish: (event: unknown) => {
          if (failures > 0) {
            failures -= 1;
            return Promise.reject(new Error("authority is temporarily unwritable"));
          }
          return inbox.publish(event);
        },
      },
    });

    await assert.rejects(notifier.detected(GAP), /temporarily unwritable/u);
    await notifier.detected(GAP);

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.count, 1);
  });

  it("folds the same gap identity after notifier restart instead of minting another row", async () => {
    const { inbox } = world();

    await createBackfillGapNotifier({ inbox }).detected(GAP);
    await createBackfillGapNotifier({ inbox }).detected(GAP);

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.count, 2);
    assert.equal(rows[0]?.version, 2);
  });

  it("refuses direct backend read-state mutation of the pinned record", async () => {
    const { inbox } = world();
    const published = await createBackfillGapNotifier({ inbox }).detected(GAP);
    assert.equal(published.published, true);
    if (!published.published) assert.fail("expected a published gap");

    assert.throws(
      () => inbox.markRead(published.report.notification.notificationId, 1),
      /pinned backfill gap/u,
    );
    const row = inbox.get(published.report.notification.notificationId);
    assert.equal(row?.status, "unread");
    assert.equal(row?.version, 1);
  });

  it("refuses direct backend snooze mutation of the pinned record", async () => {
    const { inbox } = world();
    const published = await createBackfillGapNotifier({ inbox }).detected(GAP);
    assert.equal(published.published, true);
    if (!published.published) assert.fail("expected a published gap");

    assert.throws(
      () => inbox.snooze(
        published.report.notification.notificationId,
        1,
        "2026-07-31T19:00:00.000Z",
      ),
      /pinned backfill gap/u,
    );
    const row = inbox.get(published.report.notification.notificationId);
    assert.deepEqual(row?.snooze, { state: "not-snoozed" });
    assert.equal(row?.version, 1);
  });

  it("persists one gap when a requested cursor has fallen outside retained history", async () => {
    const { inbox } = world();
    const dashboard = makeDashboardWorld();
    disposers.push(() => dashboard.dispose());
    const hub = createDashboardStreamHub({
      projection: dashboard.projection,
      retention: 1,
      backfillGaps: createBackfillGapNotifier({ inbox }),
    });
    disposers.push(() => hub.close());
    queuedEventOf(dashboard, { seed: 1 });
    const first = await hub.connect({ day: DAY });
    const oldCursor = dashboard.projection.cursor();
    first.close();
    queuedEventOf(dashboard, { seed: 2 });
    queuedEventOf(dashboard, { seed: 3 });

    const expired = await hub.connect({ day: DAY, lastEventId: oldCursor });
    expired.close();
    const repeated = await hub.connect({ day: DAY, lastEventId: oldCursor });
    repeated.close();
    const clean = await hub.connect({ day: DAY });
    clean.close();

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.trigger, "backfill-gap");
    assert.equal(rows[0]?.count, 1);
  });
});
