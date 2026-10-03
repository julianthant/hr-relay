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
  const feed = createSettingsSaveFeedback((tone, title, description) => { emitted.push(`${tone}: ${title}: ${description}`); return String(emitted.length); }, id => dismissed.push(id));
  for (const kind of ["ordinary", "protected", "provider-key"] as const) {
    assert.equal(feed.publish({ actorId: "actor", commandId, kind, replayed: false }, "actor"), "delivered");
    assert.equal(feed.publish({ actorId: "actor", commandId, kind, replayed: false }, "actor"), "duplicate");
  }
  assert.deepEqual(emitted, ["success: Saved: Settings saved.", "success: Saved: Credential settings saved.", "success: Saved: Provider keys saved."]);
  assert.equal(feed.publish({ actorId: "other", commandId, kind: "ordinary", replayed: false }, "actor"), "stale");
  feed.reset(); assert.deepEqual(dismissed, ["1", "2", "3"]);
  const failing = createSettingsSaveFeedback(() => { throw new Error("toast failed"); }, () => {});
  assert.equal(failing.publish({ actorId: "actor", commandId, kind: "ordinary", replayed: true }, "actor"), "delivery-failed");
});

it("settings server refusals use persistent danger chips, distinct command outcomes and scope", () => {
  const emitted: string[] = []; const dismissed: string[] = [];
  const feed = createSettingsSaveFeedback((tone, title, description) => { emitted.push(`${tone}: ${title}: ${description}`); return String(emitted.length); }, id => dismissed.push(id));
  for (const kind of ["ordinary", "protected", "provider-key"] as const) {
    assert.equal(feed.publishRefusal({ actorId: "actor", commandId, kind, outcome: "refused" }, "actor"), "delivered");
    assert.equal(feed.publishRefusal({ actorId: "actor", commandId, kind, outcome: "refused" }, "actor"), "duplicate");
    assert.equal(feed.publishRefusal({ actorId: "actor", commandId, kind, outcome: "conflict" }, "actor"), "delivered");
  }
  assert.equal(feed.publishRefusal({ actorId: "other", commandId, kind: "ordinary", outcome: "refused" }, "actor"), "stale");
  assert.equal(emitted.length, 6);
  assert.ok(emitted.every(item => item.startsWith("danger:")));
  assert.ok(emitted.some(item => item.includes("Settings not saved")));
  assert.ok(emitted.some(item => item.includes("Provider keys changed")));
  feed.reset(); assert.deepEqual(dismissed, ["1", "2", "3", "4", "5", "6"]);
  const failing = createSettingsSaveFeedback(() => { throw new Error("toast failed"); }, () => {});
  assert.equal(failing.publishRefusal({ actorId: "actor", commandId, kind: "ordinary", outcome: "refused" }, "actor"), "delivery-failed");
});

it("unconfirmed Settings chips are truthful, deduplicated and dismissed by exact recovery", () => {
  const emitted: string[] = []; const dismissed: string[] = [];
  const feed = createSettingsSaveFeedback((tone, title, description) => { emitted.push(`${tone}: ${title}: ${description}`); return String(emitted.length); }, id => dismissed.push(id));
  const receipt = { actorId: "actor", commandId, kind: "ordinary" as const };
  assert.equal(feed.publishUnconfirmed(receipt, "actor"), "delivered");
  assert.equal(feed.publishUnconfirmed(receipt, "actor"), "duplicate");
  assert.equal(feed.publishUnconfirmed({ ...receipt, actorId: "other" }, "actor"), "stale");
  assert.deepEqual(emitted, ["danger: Save unconfirmed: Settings save could not be confirmed. Use the existing recovery control."]);
  assert.equal(feed.publish({ ...receipt, replayed: true }, "actor"), "delivered");
  assert.deepEqual(dismissed, ["1"]);
  assert.equal(feed.publishUnconfirmed(receipt, "actor"), "duplicate");
  feed.reset(); assert.deepEqual(dismissed, ["1", "2"]);
  const failed = createSettingsSaveFeedback(() => { throw new Error("toast failed"); }, () => {});
  assert.equal(failed.publishUnconfirmed(receipt, "actor"), "delivery-failed");
});

it("known Settings outcomes settle the exact unknown chip even when replacement delivery fails", () => {
  for (const outcome of ["saved", "refused", "conflict"] as const) {
    const dismissed: string[] = []; let emits = 0;
    const feed = createSettingsSaveFeedback(() => {
      emits += 1;
      if (emits > 1) throw new Error("resolved chip failed");
      return "unknown-chip";
    }, id => dismissed.push(id));
    const receipt = { actorId: "actor", commandId, kind: "ordinary" as const };
    assert.equal(feed.publishUnconfirmed(receipt, "actor"), "delivered");
    const result = outcome === "saved"
      ? feed.publish({ ...receipt, replayed: false }, "actor")
      : feed.publishRefusal({ ...receipt, outcome }, "actor");
    assert.equal(result, "delivery-failed");
    assert.deepEqual(dismissed, ["unknown-chip"]);
    feed.reset();
    assert.deepEqual(dismissed, ["unknown-chip"]);
  }
});
