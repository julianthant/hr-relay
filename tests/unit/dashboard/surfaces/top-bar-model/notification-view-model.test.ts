import assert from "node:assert/strict";
import { it } from "vitest";
import { NotificationWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { createNotificationToastFeed } from "../../../../../src/dashboard/surfaces/notifications/notification-feedback-model.js";
import { projectNotifications } from "../../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";

const row = (publication: string, trigger: "verified-done" | "failed" = "verified-done") => NotificationWireSchema.parse({
  kind: "notification", channel: trigger === "verified-done" ? "inbox" : "ping", count: publication === "a" ? 1 : 2,
  publicationId: publication.repeat(64), trigger, readState: "unread", context: { state: "unavailable" },
  sourceEvent: { state: "available", kind: trigger === "verified-done" ? "verified-done" : "run-failed" },
  notificationId: "11111111-1111-4111-8111-111111111111", actorId: "local-operator",
  severity: trigger === "verified-done" ? "info" : "error", title: trigger === "verified-done" ? "Verified completion" : "Run failed",
  state: "unread", occurredAt: "2026-10-02T17:00:00.000Z", revision: 1,
  link: trigger === "verified-done" ? { kind: "run", runId: "22222222-2222-4222-8222-222222222222" }
    : { kind: "failure", runId: "22222222-2222-4222-8222-222222222222", failureId: "33333333-3333-4333-8333-333333333333" },
});

it("projects only declared context, explicit unavailable, and a closed folded detail", () => {
  const projected = projectNotifications([row("b")], "2026-10-02T17:01:00.000Z");
  assert.equal(projected.state, "ready");
  if (projected.state !== "ready") return;
  assert.equal(projected.items[0]?.subject, "Unavailable");
  assert.equal(projected.items[0]?.workflow, "Unavailable");
  assert.equal(projected.items[0]?.detail, "A run completed with verified evidence. 2 occurrences.");
  const served = row("a");
  if (served.kind !== "notification") return;
  const named = projectNotifications([{ ...served, context: { state: "available", workflow: "Workflow", subject: "Subject" } }], "2026-10-02T17:01:00.000Z");
  if (named.state !== "ready") return;
  assert.equal(named.items[0]?.subject, "Subject");
  const workflowOnly = projectNotifications([{ ...served, context: { state: "workflow-only", workflow: "Workflow" } }], "2026-10-02T17:01:00.000Z");
  if (workflowOnly.state !== "ready") return;
  assert.equal(workflowOnly.items[0]?.workflow, "Workflow");
  assert.equal(workflowOnly.items[0]?.subject, "Unavailable");
});

it("shows approved completion and failure chips only for new publications, not baseline, reconnect or control revisions", () => {
  const feed = createNotificationToastFeed();
  assert.equal(feed.update([row("a")], true).length, 0);
  assert.equal(feed.update([row("a")], true).length, 0);
  assert.equal(feed.update([row("b")], true)[0]?.notificationId, "11111111-1111-4111-8111-111111111111");
  assert.equal(feed.update([row("b", "verified-done")], true).length, 0);
  assert.equal(feed.update([row("a")], false).length, 0);
  assert.equal(feed.update([row("b")], true).length, 0);
  assert.equal(feed.update([row("c", "failed")], true).length, 1);
});

it("rejects a snoozed wire without its backend expiry hint and the inverse mismatch", () => {
  const ordinary = row("a");
  if (ordinary.kind !== "notification") return;
  assert.equal(NotificationWireSchema.safeParse({ ...ordinary, state: "snoozed" }).success, false);
  assert.equal(NotificationWireSchema.safeParse({ ...ordinary, snoozedUntil: "2026-10-02T18:00:00.000Z" }).success, false);
});
