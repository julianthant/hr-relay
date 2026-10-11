import assert from "node:assert/strict";
import { it } from "vitest";
import { createCommandKernel, type CommandKernelDependencies } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { NotificationRecordSchema, NotificationStateRequestSchema } from "../../../../../../src/models/notifications/notifications.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { CommandIdentityConflictError, CommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import { notificationRecordOf } from "../../../../../support/helpers/backend/dashboard-harness.js";

const NOW = "2026-10-02T17:00:00.000Z";
const actor = "local-operator";
const source = "notification-bell";
const commandId = (n: number) => `eeeeeeee-${String(n).padStart(4, "0")}-4000-8000-${String(n).padStart(4, "0")}00000000`;

function harness() {
  const clock = manualClock(new Date(NOW));
  let row = notificationRecordOf({ seed: 1, title: "Run failed", lastSeenAt: NOW });
  const commands = new Map<string, { request: unknown; audit?: unknown }>();
  const repositories = {
    commands: {
      get: (id: string) => commands.get(id)?.request,
      assertIdentity: (request: { commandId: string }) => {
        const prior = commands.get(request.commandId);
        if (prior !== undefined && JSON.stringify(prior.request) !== JSON.stringify(request)) throw new CommandIdentityConflictError();
      },
      insert: (request: { commandId: string }) => {
        if (commands.has(request.commandId)) return { state: "existing" };
        commands.set(request.commandId, { request }); return { state: "inserted" };
      },
    },
    commandAudits: {
      insert: (audit: { request: { commandId: string } }) => { commands.get(audit.request.commandId)!.audit = audit; },
      findByCommand: (id: string) => commands.get(id)?.audit,
    },
    notifications: {
      get: (id: string) => id === row.notificationId ? row : undefined,
      updateState: (raw: unknown) => {
        const change = NotificationStateRequestSchema.parse(raw);
        assert.equal(change.expectedVersion, row.version);
        row = NotificationRecordSchema.parse({ ...row, status: change.status, snooze: change.snooze,
          version: row.version + 1, updatedAt: change.updatedAt });
        return row;
      },
    },
  };
  const authority = { withAuthorityTransaction: (work: (ports: typeof repositories) => unknown) => {
    const before = row, journal = new Map(commands);
    try { return work(repositories); } catch (error) { row = before; commands.clear(); for (const [id, value] of journal) commands.set(id, value); throw error; }
  } };
  const deps = { authority, clock, ids: { uuid: () => commandId(99) }, appVersion: "0.1.0",
    workerRuntime: { planWorkerCount: () => { throw new Error("unused"); }, spawnWorker: () => { throw new Error("unused"); },
      refreshBrowser: () => { throw new Error("unused"); }, reopenBrowser: () => { throw new Error("unused"); } },
    descriptors: { resolve: () => undefined }, lifecycle: {}, archiveSnapshots: {}, configIdentity: {}, intakeParser: {}, intakeProjections: {}, writeResolution: {},
  } as unknown as CommandKernelDependencies;
  const kernel = createCommandKernel(deps);
  const command = (n: number, type: "notification-read" | "notification-unread" | "notification-snooze" | "notification-unsnooze", version: number, targetActor = actor) => CommandRequestSchema.parse({
    commandId: commandId(n), requestedAt: NOW, requestedBy: actor, source, family: "notification", type,
    target: { notificationId: row.notificationId, actorId: targetActor, expectedVersion: version },
  });
  return { kernel, command, row: () => row, commands, pin: () => { row = NotificationRecordSchema.parse({ ...row, trigger: "backfill-gap", links: [], title: "Notification history is incomplete" }); } };
}

it("derives one hour from the kernel clock and preserves read state through Snooze/Unsnooze", () => {
  const h = harness();
  assert.equal(h.kernel.execute(h.command(1, "notification-read", 1)).state, "applied");
  assert.equal(h.kernel.execute(h.command(2, "notification-snooze", 2)).state, "applied");
  assert.equal(h.row().status, "read");
  assert.deepEqual(h.row().snooze, { state: "snoozed", until: "2026-10-02T18:00:00.000Z" });
  assert.equal(h.kernel.execute(h.command(3, "notification-unsnooze", 3)).state, "applied");
  assert.equal(h.row().status, "read");
  assert.deepEqual(h.row().snooze, { state: "not-snoozed" });
});

it("refuses stale, actor mismatch, pinned and payload-injected commands without state or journal changes", () => {
  const h = harness();
  const stale = h.kernel.execute(h.command(1, "notification-unsnooze", 9));
  assert.equal(stale.state, "rejected"); assert.equal(h.row().version, 1); assert.equal(h.commands.size, 0);
  const foreign = h.kernel.execute(h.command(2, "notification-snooze", 1, "foreign-actor"));
  assert.equal(foreign.state, "rejected"); assert.equal(h.commands.size, 0);
  assert.equal(CommandRequestSchema.safeParse({ ...h.command(3, "notification-snooze", 1), payload: { until: NOW } }).success, false);
  h.pin();
  assert.equal(h.kernel.execute(h.command(4, "notification-unsnooze", 1)).state, "rejected");
  assert.equal(h.row().version, 1); assert.equal(h.commands.size, 0);
});

it("returns exact replay and refuses divergent reuse without another update", () => {
  const h = harness(); const first = h.command(1, "notification-snooze", 1);
  assert.equal(h.kernel.execute(first).state, "applied");
  assert.equal(h.kernel.execute(first).state, "already-applied");
  assert.equal(h.row().version, 2);
  const divergent = h.kernel.execute({ ...first, type: "notification-unsnooze" });
  assert.equal(divergent.state, "rejected");
  assert.equal(h.row().version, 2);
});

