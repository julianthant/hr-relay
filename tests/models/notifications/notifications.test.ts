import assert from "node:assert/strict";
import { it } from "vitest";
import { NotificationRecordSchema, notificationMatchesCollection, notificationStanding, type NotificationPark, type NotificationStandingSources } from "../../../src/models/notifications/notifications.js";

const RUN = "22222222-2222-4222-8222-222222222222";
const row = (overrides: Record<string, unknown> = {}) => NotificationRecordSchema.parse({ notificationId: "77777777-7777-4777-8777-777777777777", actorId: "local-operator",
  dedupeFingerprint: "a".repeat(64), trigger: "gate-waiting", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Run waiting", summary: "Waiting for review",
  links: [{ kind: "run", runId: RUN }], count: 1, lastSeenAt: "2026-07-31T17:00:00.000Z", version: 1, createdAt: "2026-07-31T17:00:00.000Z", updatedAt: "2026-07-31T17:00:00.000Z", ...overrides });
const sources = (park: NotificationPark | undefined, concern?: string, active?: boolean, settled?: boolean): NotificationStandingSources => ({ runPark: () => park, noticePark: () => park, storageConcern: () => concern, concernActive: () => active, commandSettled: () => settled });
const storage = { trigger: "storage", title: "Storage needs attention", links: [{ kind: "storage", diagnosticFingerprint: "d".repeat(64) }] };

it("stands while the run still holds the gate or write it names, and not after or for another one", () => {
  const gate = (id: string): NotificationPark => ({ trigger: "gate-waiting", id }), write = (id: string): NotificationPark => ({ trigger: "write-parked", id });
  const parked = row({ trigger: "write-parked", title: "Write parked" });
  const named = (held: NotificationPark | undefined, notice: NotificationPark | undefined): NotificationStandingSources => ({ ...sources(held), noticePark: () => notice });
  assert.equal(notificationStanding(row(), named(gate("approval"), gate("approval"))), true);
  assert.equal(notificationStanding(row(), named(gate("review"), gate("approval"))), false, "the run moved on to another gate");
  assert.equal(notificationStanding(row(), named(undefined, gate("approval"))), false, "handled");
  assert.equal(notificationStanding(row(), named(write("approval"), gate("approval"))), false);
  assert.equal(notificationStanding(parked, named(write("first"), write("first"))), true);
  assert.equal(notificationStanding(parked, named(write("second"), write("first"))), false, "the run parked another write");
  assert.equal(notificationStanding(parked, named(undefined, write("first"))), false, "handled");
  assert.equal(notificationStanding(parked, named(gate("first"), write("first"))), false);
  assert.equal(notificationStanding(row(), named(gate("approval"), undefined)), true, "nothing proves which gate it named handled");
  assert.equal(notificationStanding(row({ trigger: "failed", title: "Run failed" }), named(gate("approval"), gate("approval"))), false);
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
