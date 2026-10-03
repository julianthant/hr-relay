import assert from "node:assert/strict";
import { it } from "vitest";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { CommandIdSchema, NotificationIdSchema } from "../../../../../src/rules/identity/ids.js";
import { createSettingsSaveFeedback } from "../../../../../src/dashboard/surfaces/settings-save-feedback-model.js";
import { createNotificationControlFeedback, notificationControlFeedback } from "../../../../../src/dashboard/surfaces/notifications/notification-control-feedback-model.js";

const commandId = CommandIdSchema.parse("11111111-1111-4111-8111-111111111111");
const notificationId = NotificationIdSchema.parse("22222222-2222-4222-8222-222222222222");
const command = { commandId, type: "notification-read" as const, target: { notificationId } };

it("requires matching command and target for control acknowledgement and keeps refusal distinct from unknown", () => {
  const applied = CommandResultSchema.parse({ state: "applied", commandId, affectedTargets: [{ family: "notification", notificationId }] });
  assert.deepEqual(notificationControlFeedback(command, applied), { tone: "success", title: "Marked read", description: "Notification updated.", outcome: "confirmed" });
  assert.deepEqual((["notification-unread", "notification-snooze", "notification-unsnooze"] as const)
    .map(type => notificationControlFeedback({ ...command, type }, applied).title), ["Marked unread", "Snoozed", "Unsnoozed"]);
  assert.equal(notificationControlFeedback(command, CommandResultSchema.parse({ state: "applied", commandId, affectedTargets: [{ family: "notification", notificationId: NotificationIdSchema.parse("33333333-3333-4333-8333-333333333333") }] })).outcome, "unknown");
  assert.equal(notificationControlFeedback(command, { ...applied, commandId: CommandIdSchema.parse("44444444-4444-4444-8444-444444444444") }).outcome, "unknown");
  const conflict = CommandResultSchema.parse({ state: "conflict", commandId, currentVersion: 2, message: "moved" });
  assert.equal(notificationControlFeedback(command, conflict).outcome, "refused");
  const rejected = CommandResultSchema.parse({ state: "rejected", commandId, code: "policy-refused", message: "refused" });
  assert.equal(notificationControlFeedback(command, rejected).outcome, "refused");
  assert.equal(notificationControlFeedback(command, undefined).outcome, "unknown");
});

it("deduplicates control outcomes per command and scope and dismisses obsolete chips", () => {
  const emitted: string[] = []; const dismissed: string[] = [];
  const feed = createNotificationControlFeedback(feedback => { emitted.push(feedback.title); return String(emitted.length); }, id => dismissed.push(id));
  const confirmed = notificationControlFeedback(command, CommandResultSchema.parse({ state: "applied", commandId, affectedTargets: [{ family: "notification", notificationId }] }));
  const unknown = notificationControlFeedback(command, undefined);
  assert.equal(feed.publish("actor:day:client", commandId, confirmed), "delivered");
  assert.equal(feed.publish("actor:day:client", commandId, confirmed), "duplicate");
  assert.equal(feed.publish("actor:day:client", commandId, unknown), "delivered");
  feed.reset();
  assert.deepEqual(dismissed, ["1", "2"]);
  assert.equal(emitted.length, 2);
});

it("settings save chips carry only closed save facts, and adapter failures do not change confirmation", () => {
  const emitted: string[] = []; const dismissed: string[] = [];
  const feed = createSettingsSaveFeedback((title, description) => { emitted.push(`${title}: ${description}`); return String(emitted.length); }, id => dismissed.push(id));
  for (const kind of ["ordinary", "protected", "provider-key"] as const) {
    assert.equal(feed.publish({ actorId: "actor", commandId, kind, replayed: false }, "actor"), "delivered");
    assert.equal(feed.publish({ actorId: "actor", commandId, kind, replayed: false }, "actor"), "duplicate");
  }
  assert.deepEqual(emitted, ["Saved: Settings saved.", "Saved: Credential settings saved.", "Saved: Provider keys saved."]);
  assert.equal(feed.publish({ actorId: "other", commandId, kind: "ordinary", replayed: false }, "actor"), "stale");
  feed.reset(); assert.deepEqual(dismissed, ["1", "2", "3"]);
  const failing = createSettingsSaveFeedback(() => { throw new Error("toast failed"); }, () => {});
  assert.equal(failing.publish({ actorId: "actor", commandId, kind: "ordinary", replayed: true }, "actor"), "delivery-failed");
});
