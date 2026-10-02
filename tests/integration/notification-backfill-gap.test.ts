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
  deriveNotificationDedupeFingerprint,
  projectNotificationTrigger,
} from "../../src/domain/notification-triggers.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { createDashboardStreamHub } from "../../src/backend/transports/dashboard/subscriptions/dashboard-stream.js";
import { createBackfillGapNotifier } from "../../src/backend/runs/notifications/backfill-gap.js";
import { createNotificationInbox } from "../../src/backend/runs/notifications/inbox.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  DAY,
  makeWorld as makeDashboardWorld,
  queuedEventOf,
} from "../helpers/backend/dashboard-harness.js";

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
  return { database, inbox };
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

  it("keeps one identity when the retained snapshot boundary later ages into cursor expiry", () => {
    const atBoundary = deriveNotificationDedupeFingerprint({ ...GAP, reason: "snapshot-boundary" });
    const afterRetentionAged = deriveNotificationDedupeFingerprint({ ...GAP, reason: "cursor-expired" });

    assert.equal(afterRetentionAged, atBoundary);
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

  it("preserves the permanent row without count or version churn after notifier restart", async () => {
    const { inbox } = world();

    await createBackfillGapNotifier({ inbox }).detected(GAP);
    await createBackfillGapNotifier({ inbox }).detected(GAP);

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.count, 1);
    assert.equal(rows[0]?.version, 1);
    assert.equal(rows[0]?.lastSeenAt, NOW);
    assert.equal(rows[0]?.updatedAt, NOW);
  });

  it("single-flights simultaneous clients observing one missing interval", async () => {
    const { inbox } = world();
    let publishCalls = 0;
    let releasePublish: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const notifier = createBackfillGapNotifier({
      inbox: {
        publish: async (event: unknown) => {
          publishCalls += 1;
          await held;
          return inbox.publish(event);
        },
      },
    });

    const first = notifier.detected(GAP);
    const second = notifier.detected({ ...GAP, reason: "snapshot-boundary", currentCursor: "pc:13" });
    assert.equal(publishCalls, 1);
    releasePublish?.();
    const reports = await Promise.all([first, second]);

    assert.deepEqual(reports.map(({ published }) => published).sort(), [false, true]);
    assert.equal(inbox.list(LOCAL_OPERATOR_ACTOR_ID).length, 1);
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

  it("refuses a same-state mark-unread that would only bump the pinned record version", async () => {
    const { inbox } = world();
    const published = await createBackfillGapNotifier({ inbox }).detected(GAP);
    assert.equal(published.published, true);
    if (!published.published) assert.fail("expected a published gap");

    assert.throws(
      () => inbox.markUnread(published.report.notification.notificationId, 1),
      /pinned backfill gap/u,
    );
    assert.equal(inbox.get(published.report.notification.notificationId)?.version, 1);
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

  it("refuses clear-snooze even when the pinned record is already not snoozed", async () => {
    const { inbox } = world();
    const published = await createBackfillGapNotifier({ inbox }).detected(GAP);
    assert.equal(published.published, true);
    if (!published.published) assert.fail("expected a published gap");

    assert.throws(
      () => inbox.clearSnooze(published.report.notification.notificationId, 1),
      /pinned backfill gap/u,
    );
    assert.equal(inbox.get(published.report.notification.notificationId)?.version, 1);
  });

  it("refuses direct authority state writes and folds for a pinned record", async () => {
    const { database, inbox } = world();
    const published = await createBackfillGapNotifier({ inbox }).detected(GAP);
    assert.equal(published.published, true);
    if (!published.published) assert.fail("expected a published gap");
    const row = published.report.notification;

    assert.throws(
      () => database.authority.notifications.updateState({
        notificationId: row.notificationId,
        expectedVersion: 1,
        status: "unread",
        snooze: { state: "not-snoozed" },
        updatedAt: NOW,
      }),
      /pinned backfill gap/u,
    );
    assert.throws(
      () => database.authority.notifications.fold({
        actorId: row.actorId,
        dedupeFingerprint: row.dedupeFingerprint,
        seenAt: NOW,
        title: row.title,
        summary: row.summary,
      }),
      /pinned backfill gap/u,
    );
    assert.equal(database.authority.notifications.get(row.notificationId)?.version, 1);
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
    const oldGeneration = dashboard.projection.generation();
    first.close();
    queuedEventOf(dashboard, { seed: 2 });
    queuedEventOf(dashboard, { seed: 3 });

    const expired = await hub.connect({
      day: DAY,
      lastEventId: oldCursor,
      lastProjectionGeneration: oldGeneration,
    });
    expired.close();
    const repeated = await hub.connect({
      day: DAY,
      lastEventId: oldCursor,
      lastProjectionGeneration: oldGeneration,
    });
    repeated.close();
    const clean = await hub.connect({ day: DAY });
    clean.close();

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.trigger, "backfill-gap");
    assert.equal(rows[0]?.count, 1);
  });
});
