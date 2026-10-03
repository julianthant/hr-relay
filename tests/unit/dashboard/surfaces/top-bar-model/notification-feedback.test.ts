import assert from "node:assert/strict";
import { it } from "vitest";
import { NotificationWireSchema, notificationSourceEventOf, notificationWireOf } from "../../../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema } from "../../../../../src/models/notifications/notifications.js";
import { projectNotificationTrigger } from "../../../../../src/rules/notifications/notification-triggers.js";
import { createNotificationToastFeed, notificationRowsForActor, notificationToastPresentation, notificationFeedbackPolicy } from "../../../../../src/dashboard/surfaces/notifications/notification-feedback-model.js";

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

it("admits all eight declared backend events and rejects unknown kinds", () => {
  assert.deepEqual(notificationFeedbackPolicy("run-failed"), { state: "admitted", toast: "danger", panel: true, target: "failure", trigger: "failed" });
  assert.deepEqual(notificationFeedbackPolicy("subject-mismatch"), { state: "admitted", toast: "danger", panel: true, target: "failure", trigger: "failed" });
  assert.deepEqual(notificationFeedbackPolicy("repeating-failure"), { state: "admitted", toast: "warning", panel: true, target: "failure", trigger: "repeating" });
  assert.deepEqual(notificationFeedbackPolicy("verified-done"), { state: "admitted", toast: "success", panel: true, target: "run", trigger: "verified-done" });
  assert.deepEqual(notificationFeedbackPolicy("gate-opened"), { state: "admitted", toast: "warning", panel: true, target: "run", trigger: "gate-waiting" });
  assert.deepEqual(notificationFeedbackPolicy("write-parked"), { state: "admitted", toast: "danger", panel: true, target: "run", trigger: "write-parked" });
  assert.deepEqual(notificationFeedbackPolicy("storage-degraded"), { state: "admitted", toast: "warning", panel: true, target: "storage", trigger: "storage" });
  assert.deepEqual(notificationFeedbackPolicy("backfill-gap"), { state: "admitted", toast: "danger", panel: true, target: "none", trigger: "backfill-gap" });
  assert.deepEqual(notificationFeedbackPolicy(undefined), { state: "provenance-unavailable" });
  assert.throws(() => notificationFeedbackPolicy("made-up"), /NOTIFICATION_FEEDBACK_KIND_UNREGISTERED/);
  assert.equal(NotificationWireSchema.safeParse({ ...row("a"), sourceEvent: { state: "available", kind: "made-up" } }).success, false);
});

it("delivers a new committed failure once, not baseline, read revision, disconnect or replay", () => {
  const feed = createNotificationToastFeed();
  assert.deepEqual(feed.update([row("a")], true), []);
  assert.deepEqual(feed.update([row("a", { revision: 2, readState: "read" })], true), []);
  assert.equal(feed.update([row("b")], true).length, 1);
  assert.deepEqual(feed.update([row("b")], true), []);
  assert.deepEqual(feed.update([row("c")], false), []);
  assert.deepEqual(feed.update([row("c")], true), []);
  assert.equal(feed.update([row("d")], true).length, 1);
});

it("consumes snoozed and unavailable publications without delayed replay", () => {
  const feed = createNotificationToastFeed();
  feed.update([row("a")], true);
  const snoozed = row("b", { state: "snoozed", snoozedUntil: "2026-10-02T18:00:00.000Z" });
  assert.deepEqual(feed.update([snoozed], true), []);
  assert.deepEqual(feed.update([row("b")], true), []);
  assert.deepEqual(feed.update([row("c", { sourceEvent: { state: "unavailable" } })], true), []);
  assert.equal(feed.update([row("d", { sourceEvent: { state: "available", kind: "subject-mismatch" } })], true).length, 1);
  assert.equal(feed.update([row("e")], true).length, 1);
  feed.reset();
  assert.deepEqual(feed.update([row("e")], true), []);
});

it("composes distinct chip text and tones from closed display facts", () => {
  const available = row("a");
  if (available.kind !== "notification") return;
  assert.deepEqual(notificationToastPresentation(available), { tone: "danger", action: "Open failure", title: "Run failed", description: "Workflow · Subject" });
  assert.equal(notificationToastPresentation({ ...available, context: { state: "unavailable" } }).description, "A run failed.");
  assert.deepEqual(notificationToastPresentation({ ...available, sourceEvent: { state: "available", kind: "subject-mismatch" } }), { tone: "danger", action: "Open failure", title: "Subject mismatch", description: "Workflow · A subject mismatch was detected." });
  assert.equal(notificationToastPresentation({ ...available, sourceEvent: { state: "available", kind: "subject-mismatch" } }).description.includes("Subject"), false);
  assert.deepEqual(notificationToastPresentation({ ...available, sourceEvent: { state: "available", kind: "repeating-failure" } }), { tone: "warning", action: "Open failure", title: "Repeating failure", description: "Workflow · A failure pattern repeated." });
  assert.deepEqual(notificationToastPresentation({ ...available, sourceEvent: { state: "available", kind: "verified-done" } }), { tone: "success", action: "Open run", title: "Verified completion", description: "Workflow · A run completed with verified evidence." });
  assert.deepEqual(notificationToastPresentation({ ...available, sourceEvent: { state: "available", kind: "gate-opened" } }), { tone: "warning", action: "Open run", title: "Needs you", description: "Workflow · A run needs operator attention." });
  assert.deepEqual(notificationToastPresentation({ ...available, sourceEvent: { state: "available", kind: "write-parked" } }), { tone: "danger", action: "Open run", title: "Write parked", description: "Workflow · A write is parked for review." });
  assert.deepEqual(notificationToastPresentation({ ...available, sourceEvent: { state: "available", kind: "storage-degraded" } }), { tone: "warning", action: "Open Storage", title: "Storage needs attention", description: "Storage needs attention." });
});

it("keeps all eight source kinds as distinct publication chips", () => {
  const feed = createNotificationToastFeed();
  feed.update([row("a")], true);
  const mismatch = row("c", { notificationId: "44444444-4444-4444-8444-444444444444", sourceEvent: { state: "available", kind: "subject-mismatch" } });
  const repeating = row("d", { notificationId: "55555555-5555-4555-8555-555555555555", trigger: "repeating", severity: "warning", sourceEvent: { state: "available", kind: "repeating-failure" } });
  const done = row("e", { notificationId: "66666666-6666-4666-8666-666666666666", trigger: "verified-done", severity: "info", channel: "inbox", sourceEvent: { state: "available", kind: "verified-done" }, link: { kind: "run", runId: "22222222-2222-4222-8222-222222222222" } });
  const gate = row("f", { notificationId: "88888888-8888-4888-8888-888888888888", trigger: "gate-waiting", severity: "warning", sourceEvent: { state: "available", kind: "gate-opened" }, link: { kind: "run", runId: "22222222-2222-4222-8222-222222222222" } });
  const parked = row("1", { notificationId: "99999999-9999-4999-8999-999999999999", trigger: "write-parked", sourceEvent: { state: "available", kind: "write-parked" }, link: { kind: "run", runId: "22222222-2222-4222-8222-222222222222" } });
  const storage = row("2", { notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", trigger: "storage", severity: "warning", context: { state: "not-applicable" }, sourceEvent: { state: "available", kind: "storage-degraded" }, link: { kind: "storage" } });
  const pinned = NotificationWireSchema.parse({ kind: "backfill-gap", channel: "ping", count: 1, publicationId: "3".repeat(64), notificationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", actorId: "local-operator", severity: "error", title: "Notification history is incomplete", state: "pinned", occurredAt: "2026-10-02T17:00:00.000Z", sourceEvent: { state: "available", kind: "backfill-gap" } });
  const current = [row("b"), mismatch, repeating, done, gate, parked, storage, pinned];
  assert.deepEqual(feed.update(current, true).map(candidate => candidate.sourceEvent?.state === "available" ? candidate.sourceEvent.kind : undefined), ["run-failed", "subject-mismatch", "repeating-failure", "verified-done", "gate-opened", "write-parked", "storage-degraded", "backfill-gap"]);
  assert.deepEqual(feed.update(current, true), []);
  assert.deepEqual(feed.update(current.map(candidate => candidate.kind === "notification" ? NotificationWireSchema.parse({ ...candidate, revision: 2 }) : candidate), true), []);
});

it("does not deliver another actor's retained row during an active actor transition", () => {
  const feed = createNotificationToastFeed();
  feed.update(notificationRowsForActor([row("a")], "local-operator"), true);
  const foreign = row("b", { actorId: "other-operator", context: { state: "available", workflow: "Foreign workflow", subject: "Foreign subject" } });
  assert.deepEqual(feed.update(notificationRowsForActor([foreign], "local-operator"), true), []);
  feed.reset();
  assert.deepEqual(feed.update(notificationRowsForActor([foreign], "other-operator"), true), []);
  assert.equal(feed.update(notificationRowsForActor([row("c", { actorId: "other-operator" })], "other-operator"), true).length, 1);
});

it("delivers a proven pinned backfill gap once without a fabricated action", () => {
  const pinned = (publication: string, sourceEvent: unknown) => NotificationWireSchema.parse({
    kind: "backfill-gap", channel: "ping", count: 1, publicationId: publication.repeat(64),
    notificationId: "77777777-7777-4777-8777-777777777777", actorId: "local-operator",
    severity: "error", title: "Notification history is incomplete", state: "pinned", occurredAt: "2026-10-02T17:00:00.000Z", sourceEvent,
  });
  const feed = createNotificationToastFeed();
  assert.deepEqual(feed.update([pinned("a", { state: "available", kind: "backfill-gap" })], true), []);
  assert.deepEqual(feed.update([pinned("b", { state: "unavailable" })], true), []);
  const delivered = feed.update([pinned("c", { state: "available", kind: "backfill-gap" })], true);
  assert.equal(delivered.length, 1);
  assert.deepEqual(notificationToastPresentation(delivered[0]), { tone: "danger", title: "Notification history is incomplete", description: "Resnapshot and reconcile the affected work." });
  assert.deepEqual(feed.update([pinned("c", { state: "available", kind: "backfill-gap" })], true), []);
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

it("serves pinned gap provenance from its canonical publication without adding a target", () => {
  const event = { kind: "backfill-gap", detector: "server-resume", reason: "cursor-expired", topic: "dashboard-day", requestedCursor: "pc:1", currentCursor: "pc:2", projectionGeneration: 1 };
  const projection = projectNotificationTrigger(event);
  const record = NotificationRecordSchema.parse({
    notificationId: "77777777-7777-4777-8777-777777777777", actorId: "local-operator",
    ...projection, status: "unread", snooze: { state: "not-snoozed" }, count: 1,
    lastSeenAt: "2026-10-02T17:00:00.000Z", version: 1, createdAt: "2026-10-02T17:00:00.000Z", updatedAt: "2026-10-02T17:00:00.000Z",
  });
  const provenance = notificationSourceEventOf(record, { actorId: record.actorId, notificationId: record.notificationId, adopted: false, event });
  const wire = notificationWireOf(record, Date.parse("2026-10-02T17:01:00.000Z"), undefined, provenance);
  assert.equal(wire.kind, "backfill-gap");
  assert.deepEqual(wire.sourceEvent, { state: "available", kind: "backfill-gap" });
  assert.equal("link" in wire, false);
  assert.deepEqual(notificationSourceEventOf(record), { state: "unavailable" });
});
