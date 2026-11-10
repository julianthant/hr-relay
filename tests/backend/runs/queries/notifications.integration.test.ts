import { describe,expect,it } from "vitest";
import { createNotificationTargetQuery } from "../../../../src/backend/runs/queries/notifications.js";
import { deriveBulkChildCommand } from "../../../../src/rules/commands/command-groups.js";
import { BulkRunCommandAcceptanceRecordSchema, BulkRunCommandRequestSchema, CommandRequestSchema, CommandResultSchema, deriveBulkRunCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { projectNotificationTrigger } from "../../../../src/rules/notifications/notification-triggers.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { NOW, UUID_1, UUID_2, UUID_3, UUID_4, UUID_5, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { failureRecordOf,notificationRecordOf,runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";

describe("notification destinations", () => {
  it("resolves the canonical run date, checks actor, and refuses a deletion between lookups", () => {
    const run = runRecordOf({ seed: 1, enqueuedAt: "2026-07-03T18:00:00.000Z" });
    const row = notificationRecordOf({ seed: 1, title: "private title", lastSeenAt: run.createdAt });
    let deleted = false;
    const query = createNotificationTargetQuery({ get: () => row, read: () => deleted ? { state: "absent", runId: run.envelope.runId } : { state: "present", disposition: "live", run }, failure: () => undefined, command: () => undefined, bulk: () => undefined });
    expect(query(row.notificationId, "another-actor")).toMatchObject({ kind: "refused", reason: "wrong-actor" });
    expect(query(row.notificationId, row.actorId)).toEqual({ kind: "run", runId: run.envelope.runId, day: "2026-07-03" });
    deleted = true;
    expect(query(row.notificationId, row.actorId)).toMatchObject({ kind: "refused", reason: "run-unavailable" });
    expect(() => query("malformed", row.actorId)).toThrow();
  });
  it("opens the host row for a hidden run", () => {
    const hidden = runRecordOf({ seed: 3, enqueuedAt: "2026-07-03T18:00:00.000Z" });
    const host = runRecordOf({ seed: 4, enqueuedAt: "2026-07-04T18:00:00.000Z" });
    const row = notificationRecordOf({ seed: 3, title: "Records ready", lastSeenAt: hidden.createdAt });
    const query = createNotificationTargetQuery({ get: () => row, read: () => ({ state: "present", disposition: "live", run: hidden }), failure: () => undefined, command: () => undefined, bulk: () => undefined,
      host: run => run === hidden ? host : undefined });
    expect(query(row.notificationId, row.actorId)).toEqual({ kind: "run", runId: host.envelope.runId, day: "2026-07-04" });
  });
  it("preserves exact failure identity and Storage", () => {
    const failure = failureRecordOf({ seed: 2, code: "TEST_FAILURE" });
    const run = runRecordOf({ seed: 2, enqueuedAt: failure.occurredAt, lifecycle: { state: "terminal", outcome: "failed", failureId: failure.failureId, endedAt: failure.occurredAt } });
    const row = notificationRecordOf({ seed: 2, title: "Failure", lastSeenAt: run.updatedAt });
    row.links = [{ kind: "failure", runId: run.envelope.runId, failureId: failure.failureId }];
    const query = createNotificationTargetQuery({ get: () => row, read: () => ({ state: "present", disposition: "live", run }), failure: () => failure, command: () => undefined, bulk: () => undefined });
    expect(query(row.notificationId, row.actorId)).toMatchObject({ kind: "failure", failureId: failure.failureId });
    row.links = [{ kind: "storage", diagnosticFingerprint: row.dedupeFingerprint }];
    expect(query(row.notificationId, row.actorId)).toEqual({ kind: "storage" });
  });
});

describe("command destinations", () => {
  const commandId = UUID_1;
  const runId = UUID_2;
  const request = CommandRequestSchema.parse({ commandId, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "run", type: "retry", target: { runId, expectedVersion: 1 } });
  const applied = CommandResultSchema.parse({ state: "applied", commandId, affectedTargets: [{ family: "run", runId }] });
  function notice(kind: "command-unknown" | "command-refused" | "bulk-incomplete") {
    const event = kind === "bulk-incomplete" ? { kind, bulkCommandId: UUID_8 } : kind === "command-refused" ? { kind, commandId, outcome: "rejected" as const } : { kind, commandId };
    const projection = projectNotificationTrigger(event);
    const row = notificationRecordOf({ seed: 9, title: projection.title, lastSeenAt: NOW });
    row.trigger = projection.trigger;
    row.channel = projection.channel;
    row.summary = projection.summary;
    row.links = projection.links;
    row.dedupeFingerprint = projection.dedupeFingerprint;
    return row;
  }
  const base = { failure: () => undefined, read: () => ({ state: "absent" as const, runId: RunIdSchema.parse(UUID_2) }), command: () => undefined, bulk: () => undefined };

  it("resolves recovery before and after settlement, and a command result", () => {
    const recovery = notice("command-unknown");
    const open = (command: { request: typeof request; state: "admitted" | "executing" | "refused"; result?: typeof applied } | undefined) => createNotificationTargetQuery({ ...base, get: () => recovery, command: () => command });
    expect(open({ request, state: "admitted" })(recovery.notificationId, recovery.actorId)).toEqual({ kind: "recovery", commandId, request });
    expect(open({ request, state: "refused", result: applied })(recovery.notificationId, recovery.actorId)).toEqual({ kind: "command-result", commandId, request, result: applied });
    expect(open(undefined)(recovery.notificationId, recovery.actorId)).toMatchObject({ kind: "refused", reason: "target-unavailable" });
    expect(open({ request, state: "executing" })(recovery.notificationId, recovery.actorId)).toMatchObject({ kind: "refused", reason: "target-unavailable" });
    const settled = notice("command-refused");
    expect(createNotificationTargetQuery({ ...base, get: () => settled, command: () => ({ request, state: "refused", result: applied }) })(settled.notificationId, settled.actorId)).toEqual({ kind: "command-result", commandId, request, result: applied });
    expect(createNotificationTargetQuery({ ...base, get: () => settled, command: () => ({ request, state: "admitted" }) })(settled.notificationId, settled.actorId)).toMatchObject({ kind: "refused", reason: "target-unavailable" });
  });

  it("maps applied, conflict, refused and errored children, plus runs with no child row", () => {
    const accepted = BulkRunCommandRequestSchema.parse({
      commandId: UUID_8, bulkCommandId: UUID_8, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "run", type: "cancel", mode: "best-effort",
      targets: [UUID_1, UUID_2, UUID_3, UUID_4, UUID_5].map(id => ({ runId: id, expectedVersion: 1 })),
    });
    const acceptance = BulkRunCommandAcceptanceRecordSchema.parse({ bulkCommandId: UUID_8, request: accepted, requestFingerprint: deriveBulkRunCommandFingerprint(accepted) });
    const results = [
      (id: string) => CommandResultSchema.parse({ state: "applied", commandId: id, affectedTargets: [{ family: "run", runId: UUID_1 }] }),
      (id: string) => CommandResultSchema.parse({ state: "conflict", commandId: id, currentVersion: 4, message: "changed" }),
      (id: string) => CommandResultSchema.parse({ state: "rejected", commandId: id, code: "schema-mismatch", message: "refused" }),
      (id: string) => CommandResultSchema.parse({ state: "rejected", commandId: id, code: "bulk-child-errored", message: "threw" }),
    ];
    const children = accepted.targets.slice(0, 4).map((target, index) => {
      const child = deriveBulkChildCommand(accepted, target);
      return { request: child, state: "succeeded" as const, result: results[index]!(child.commandId) };
    });
    const row = notice("bulk-incomplete");
    const target = createNotificationTargetQuery({ ...base, get: () => row, bulk: () => ({ acceptance, children }) })(row.notificationId, row.actorId);
    expect(target).toEqual({
      kind: "bulk-result", bulkCommandId: UUID_8, type: "cancel", requestedCount: 5,
      results: [
        { outcome: "applied", runId: UUID_1, commandId: children[0]!.request.commandId, replayed: false, detail: "cancel recorded" },
        { outcome: "conflict", runId: UUID_2, commandId: children[1]!.request.commandId, currentVersion: 4, detail: "changed" },
        { outcome: "refused", runId: UUID_3, commandId: children[2]!.request.commandId, code: "schema-mismatch", detail: "refused" },
        { outcome: "errored", runId: UUID_4, commandId: children[3]!.request.commandId, detail: "threw" },
      ],
      notAttempted: [UUID_5],
    });
    const replayed = { ...children[0]!, result: CommandResultSchema.parse({ state: "already-applied", commandId: children[0]!.request.commandId, affectedTargets: [{ family: "run", runId: UUID_1 }] }) };
    expect(createNotificationTargetQuery({ ...base, get: () => row, bulk: () => ({ acceptance, children: [replayed, ...children.slice(1)] }) })(row.notificationId, row.actorId)).toMatchObject({ results: [{ replayed: false, detail: "cancel recorded" }] });
    expect(createNotificationTargetQuery({ ...base, get: () => row })(row.notificationId, row.actorId)).toMatchObject({ kind: "refused", reason: "target-unavailable" });
  });
});
