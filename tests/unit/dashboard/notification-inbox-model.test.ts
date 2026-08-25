/** Track F A46: pinned safety records live outside every ordinary inbox filter. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NotificationWireSchema } from "../../../src/domain/dashboard/projection.js";
import {
  NOTIFICATION_FILTERS,
  notificationInboxView,
  type NotificationRowWire,
} from "../../../src/dashboard/surfaces/top-bar-model.js";

const PINNED = NotificationWireSchema.parse({
  kind: "backfill-gap",
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
  notificationId: "22222222-2222-4222-8222-222222222222",
  actorId: "local-operator",
  severity: "info",
  title: "Done",
  state: "unread",
  occurredAt: "2026-08-25T17:01:00.000Z",
  revision: 1,
  }),
  delivery: "inbox",
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
