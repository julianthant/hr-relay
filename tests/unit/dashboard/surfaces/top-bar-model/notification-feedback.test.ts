import assert from "node:assert/strict";
import { it } from "vitest";
import { NotificationWireSchema, notificationSourceEventOf } from "../../../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema } from "../../../../../src/models/notifications/notifications.js";
import { projectNotificationTrigger } from "../../../../../src/rules/notifications/notification-triggers.js";
import { createFailureToastFeed, failedRunToastDescription, notificationFeedbackPolicy } from "../../../../../src/dashboard/surfaces/notifications/notification-feedback-model.js";

function row(publication: string, changes: Record<string, unknown> = {}) {
  return NotificationWireSchema.parse({
    kind: "notification", channel: "ping", count: 1, publicationId: publication.repeat(64),
    trigger: "failed", readState: "unread", context: { state: "available", workflow: "Workflow", subject: "Subject" },
    sourceEvent: { state: "available", kind: "run-failed" },
    notificationId: "11111111-1111-4111-8111-111111111111", actorId: "local-operator",
    severity: "error", title: "Run failed", state: "unread", occurredAt: "2026-10-02T17:00:00.000Z", revision: 1,
    link: { kind: "failure", runId: "22222222-2222-4222-8222-222222222222", failureId: "33333333-3333-4333-8333-333333333333" },
    ...changes,
  });
}

it("admits only declared run failure and rejects unknown kinds", () => {
  assert.deepEqual(notificationFeedbackPolicy("run-failed"), { state: "admitted", toast: "danger", panel: true });
  assert.deepEqual(notificationFeedbackPolicy("subject-mismatch"), { state: "unresolved" });
  assert.deepEqual(notificationFeedbackPolicy(undefined), { state: "provenance-unavailable" });
  assert.throws(() => notificationFeedbackPolicy("made-up"), /NOTIFICATION_FEEDBACK_KIND_UNREGISTERED/);
  assert.equal(NotificationWireSchema.safeParse({ ...row("a"), sourceEvent: { state: "available", kind: "made-up" } }).success, false);
});

it("delivers a new committed failure once, not baseline, read revision, disconnect or replay", () => {
  const feed = createFailureToastFeed();
  assert.deepEqual(feed.update([row("a")], true), []);
  assert.deepEqual(feed.update([row("a", { revision: 2, readState: "read" })], true), []);
  assert.equal(feed.update([row("b")], true).length, 1);
  assert.deepEqual(feed.update([row("b")], true), []);
  assert.deepEqual(feed.update([row("c")], false), []);
  assert.deepEqual(feed.update([row("c")], true), []);
  assert.equal(feed.update([row("d")], true).length, 1);
});

it("consumes snoozed, unavailable, and separate mismatch publications without a chip", () => {
  const feed = createFailureToastFeed();
  feed.update([row("a")], true);
  const snoozed = row("b", { state: "snoozed", snoozedUntil: "2026-10-02T18:00:00.000Z" });
  assert.deepEqual(feed.update([snoozed], true), []);
  assert.deepEqual(feed.update([row("b")], true), []);
  assert.deepEqual(feed.update([row("c", { sourceEvent: { state: "unavailable" } })], true), []);
  assert.deepEqual(feed.update([row("d", { sourceEvent: { state: "available", kind: "subject-mismatch" } })], true), []);
  assert.equal(feed.update([row("e")], true).length, 1);
  feed.reset();
  assert.deepEqual(feed.update([row("e")], true), []);
});

it("composes chip description only from closed display facts", () => {
  const available = row("a");
  if (available.kind !== "notification") return;
  assert.equal(failedRunToastDescription(available), "Workflow · Subject");
  assert.equal(failedRunToastDescription({ ...available, context: { state: "unavailable" } }), "A run failed.");
});

it("takes event provenance from the committed publication and refuses a mismatched row", () => {
  const event = { kind: "run-failed", runId: "22222222-2222-4222-8222-222222222222", workflowId: "workflow", failureId: "33333333-3333-4333-8333-333333333333", failureFingerprint: "a".repeat(64), code: "RUN_FAILED" };
  const projection = projectNotificationTrigger(event);
  const record = NotificationRecordSchema.parse({
    notificationId: "11111111-1111-4111-8111-111111111111", actorId: "local-operator",
    ...projection, status: "unread", snooze: { state: "not-snoozed" }, count: 1,
    lastSeenAt: "2026-10-02T17:00:00.000Z", version: 1, createdAt: "2026-10-02T17:00:00.000Z", updatedAt: "2026-10-02T17:00:00.000Z",
  });
  const source = { actorId: record.actorId, notificationId: record.notificationId, event, adopted: false };
  assert.deepEqual(notificationSourceEventOf(record, source), { state: "available", kind: "run-failed" });
  assert.deepEqual(notificationSourceEventOf(record), { state: "unavailable" });
  assert.throws(() => notificationSourceEventOf(record, { ...source, actorId: "wrong" }), /NOTIFICATION_PUBLICATION_OWNER_MISMATCH/);
  assert.throws(() => notificationSourceEventOf(record, { ...source, event: { kind: "subject-mismatch", runId: event.runId, workflowId: event.workflowId, failureId: event.failureId, failureFingerprint: event.failureFingerprint } }), /NOTIFICATION_PUBLICATION_ROW_MISMATCH/);
});
