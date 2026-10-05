/** Track F A46: pinned safety records live outside every ordinary inbox filter. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NotificationWireSchema } from "../../../src/domain/dashboard/projection.js";
import {
  NOTIFICATION_FILTERS,
  notificationInboxView,
  type NotificationRowWire,
} from "../../../src/dashboard/surfaces/shell/top-bar-model.js";

const PINNED = NotificationWireSchema.parse({
  kind: "backfill-gap",
  channel: "ping", count: 1, publicationId: "a".repeat(64),
  notificationId: "11111111-1111-4111-8111-111111111111",
  actorId: "local-operator",
  severity: "error",
  title: "Notification history is incomplete",
  state: "pinned",
  occurredAt: "2026-08-25T17:00:00.000Z",
});

const ORDINARY: NotificationRowWire = {
  ...NotificationWireSchema.parse({
  kind: "notification",
  channel: "inbox", count: 1, publicationId: "b".repeat(64), trigger: "verified-done", readState: "unread",
  notificationId: "22222222-2222-4222-8222-222222222222",
  actorId: "local-operator",
  severity: "info",
  title: "Done",
  state: "unread",
  occurredAt: "2026-08-25T17:01:00.000Z",
  revision: 1,
  }),
};

describe("notification inbox model", () => {
  it("keeps the pinned gap visible outside every ordinary filter", () => {
    for (const filter of NOTIFICATION_FILTERS) {
      const view = notificationInboxView([PINNED, ORDINARY], filter.key);
      assert.deepEqual(view.pinned.map(({ notificationId }) => notificationId), [PINNED.notificationId]);
      assert.equal(view.shown.some(({ notificationId }) => notificationId === PINNED.notificationId), false);
      assert.equal(view.counts.all, 2);
      assert.equal(view.counts.unread, 2);
      assert.equal(view.critical, true);
    }
  });

  it("counts a pinned ping as visible content under the Pings filter", () => {
    const view = notificationInboxView([PINNED], "ping");

    assert.equal(view.counts.ping, 1);
    assert.equal(view.visibleCount, 1);
    assert.equal(view.empty, false);
  });
});

it("counts unread snoozed rows independently and uses the actual channel", () => {
  const row = NotificationWireSchema.parse({ ...ORDINARY, state: "snoozed", readState: "unread" });
  assert.equal(notificationInboxView([row], "unread").shown.length, 1);
  assert.equal(notificationInboxView([row], "inbox").shown.length, 1);
  assert.equal(notificationInboxView([row], "ping").shown.length, 0);
  assert.equal(notificationInboxView([row], "snoozed").shown.length, 1);
});

import { navigateNotification } from "../../../src/dashboard/surfaces/notifications/notification-navigation.js";
import { NotificationTargetSchema } from "../../../src/domain/notifications.js";
it("keeps the inbox open when dirty Settings cancels and revalidates after acceptance", async () => {
  const target = NotificationTargetSchema.parse({ kind: "run", runId: "22222222-2222-4222-8222-222222222222", day: "2026-07-03" });
  let next: (() => void) | undefined, reads = 0, opens = 0, error = "";
  const lookup = async () => { reads += 1; return target; };
  await navigateNotification({ lookup, guard: () => {}, open: () => { opens += 1; }, refused: value => { error = value; } });
  assert.equal(reads, 1); assert.equal(opens, 0);
  await navigateNotification({ lookup, guard: proceed => { next = proceed; }, open: () => { opens += 1; }, refused: value => { error = value; } });
  next?.(); await Promise.resolve();
  assert.equal(reads, 3); assert.equal(opens, 1); assert.equal(error, "");
  let calls = 0;
  await navigateNotification({ lookup: async () => ++calls === 1 ? target : { kind: "refused", reason: "run-unavailable" }, guard: proceed => proceed(), open: () => { opens += 1; }, refused: value => { error = value; } });
  await Promise.resolve(); assert.equal(opens, 1); assert.match(error, /run-unavailable/u);
});
