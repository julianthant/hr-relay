import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createNotificationBackfillTestWorld } from "../../../support/helpers/backend/notification-backfill-world.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { createBackfillGapNotifier } from "../../../../src/backend/runs/notifications/backfill-gap.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const {world, cleanup } = createNotificationBackfillTestWorld(profileFixtures.create);


const GAP = {
  kind: "backfill-gap",
  detector: "server-resume",
  reason: "cursor-expired",
  topic: "dashboard-day",
  requestedCursor: "pc:4",
  currentCursor: "pc:12",
  projectionGeneration: 3,
} as const;
afterEach(cleanup);

describe("backfill-gap notification", () => {

  it("publishes one durable record for repeated detection of the same gap", async () => {
    const { inbox } = await world();
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
    const { inbox } = await world();
    const notifier = createBackfillGapNotifier({ inbox });

    await notifier.detected(GAP);
    await notifier.detected({ ...GAP, currentCursor: "pc:13" });

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.count, 1);
    assert.equal(rows[0]?.version, 1);
  });

  it("retries the same gap after a publisher failure instead of forgetting it", async () => {
    const { inbox } = await world();
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
    const { inbox } = await world();

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
    const { inbox } = await world();
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
    const { inbox } = await world();
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
    const { inbox } = await world();
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
    const { inbox } = await world();
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
    const { inbox } = await world();
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
    const { database, inbox } = await world();
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
});
