import assert from "node:assert/strict";
import { it } from "vitest";
import { NotificationRecordSchema, notificationMatchesCollection, notificationStanding, type NotificationStandingSources } from "../../../src/models/notifications/notifications.js";

const RUN = "22222222-2222-4222-8222-222222222222";
const row = (overrides: Record<string, unknown> = {}) => NotificationRecordSchema.parse({ notificationId: "77777777-7777-4777-8777-777777777777", actorId: "local-operator",
  dedupeFingerprint: "a".repeat(64), trigger: "gate-waiting", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Run waiting", summary: "Waiting for review",
  links: [{ kind: "run", runId: RUN }], count: 1, lastSeenAt: "2026-07-31T17:00:00.000Z", version: 1, createdAt: "2026-07-31T17:00:00.000Z", updatedAt: "2026-07-31T17:00:00.000Z", ...overrides });
const sources = (state: string | undefined, concern?: string, active?: boolean, settled?: boolean): NotificationStandingSources => ({ runState: () => state, storageConcern: () => concern, concernActive: () => active, commandSettled: () => settled });
const storage = { trigger: "storage", title: "Storage needs attention", links: [{ kind: "storage", diagnosticFingerprint: "d".repeat(64) }] };

it("stands while the run still holds its gate or parked write, and not after", () => {
  assert.equal(notificationStanding(row(), sources("parked-gate")), true);
  assert.equal(notificationStanding(row(), sources("running")), false);
  assert.equal(notificationStanding(row(), sources(undefined)), false);
  assert.equal(notificationStanding(row({ trigger: "write-parked", title: "Write parked" }), sources("parked-write")), true);
  assert.equal(notificationStanding(row({ trigger: "write-parked", title: "Write parked" }), sources("parked-gate")), false);
  assert.equal(notificationStanding(row({ trigger: "failed", title: "Run failed" }), sources("parked-gate")), false);
});

it("stands while a storage concern is active or cannot be read", () => {
  assert.equal(notificationStanding(row(storage), sources(undefined, "disk-space", true)), true);
  assert.equal(notificationStanding(row(storage), sources(undefined, "disk-space", undefined)), true);
  assert.equal(notificationStanding(row(storage), sources(undefined, undefined, false)), true);
  assert.equal(notificationStanding(row(storage), sources(undefined, "disk-space", false)), false);
});

it("stands while a recovery command is unsettled, and not after or for a result notice", () => {
  const command = (kind: string) => row({ trigger: "command", title: "Command needs attention", links: [{ kind, commandId: "33333333-3333-4333-8333-333333333333" }] });
  assert.equal(notificationStanding(command("recovery"), sources(undefined, undefined, undefined, false)), true);
  assert.equal(notificationStanding(command("recovery"), sources(undefined, undefined, undefined, true)), false);
  assert.equal(notificationStanding(command("recovery"), sources(undefined)), false);
  assert.equal(notificationStanding(command("command-result"), sources(undefined, undefined, undefined, false)), false);
});

it("leaves cleared and pinned rows out of every collection", () => {
  assert.equal(notificationMatchesCollection(row({ clearedAt: "2026-07-31T17:00:00.000Z" }), "read"), false);
  assert.equal(notificationMatchesCollection(row({ trigger: "backfill-gap", title: "History", links: [] }), "read"), false);
  assert.throws(() => row({ trigger: "backfill-gap", title: "History", links: [], clearedAt: "2026-07-31T17:00:00.000Z" }));
});
