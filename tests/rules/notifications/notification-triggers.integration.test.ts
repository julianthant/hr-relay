import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NotificationTriggerEventSchema, deriveNotificationDedupeFingerprint, projectNotificationTrigger } from "../../../src/rules/notifications/notification-triggers.js";

const GAP = {
  kind: "backfill-gap",
  detector: "server-resume",
  reason: "cursor-expired",
  topic: "dashboard-day",
  requestedCursor: "pc:4",
  currentCursor: "pc:12",
  projectionGeneration: 3,
} as const;

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

  it("keeps one identity when the retained snapshot boundary later ages into cursor expiry", () => {
    const atBoundary = deriveNotificationDedupeFingerprint({ ...GAP, reason: "snapshot-boundary" });
    const afterRetentionAged = deriveNotificationDedupeFingerprint({ ...GAP, reason: "cursor-expired" });

    assert.equal(afterRetentionAged, atBoundary);
  });
});
