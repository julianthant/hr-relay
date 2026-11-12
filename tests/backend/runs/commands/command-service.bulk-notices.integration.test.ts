import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { deriveBulkChildCommandId } from "../../../../src/rules/commands/command-groups.js";
import { BulkRunCommandRequestSchema, deriveBulkRunCommandFingerprint, type BulkRunCommandRequest } from "../../../../src/rules/commands/commands.js";
import { createNotificationInbox, type NotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { NotificationRecord } from "../../../../src/models/notifications/notifications.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";

const FIRST_EMPLOYEE_ID = "10800000";
const SECOND_EMPLOYEE_ID = "10800001";

const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, nextCommandId, createPlan, startCommand } = createCommandKernelTestWorld();

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CommandStateSchema = z.strictObject({
  state: z.enum(["admitted", "executing", "succeeded", "refused", "uncertain"]),
});
const AuditCountSchema = z.strictObject({
  count: z.union([z.number().int().nonnegative(), z.bigint()]),
});

function commandJournal(path: string, commandId: string): { state: z.infer<typeof CommandStateSchema>["state"]; audits: number } {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const row = CommandStateSchema.parse(raw.prepare("SELECT state FROM commands WHERE id = ?").get(commandId));
    const count = AuditCountSchema.parse(raw.prepare("SELECT count(*) AS count FROM command_audits WHERE command_id = ?").get(commandId));
    return { state: row.state, audits: Number(count.count) };
  } finally {
    raw.close();
  }
}

function assertPrivate(notice: NotificationRecord, forbidden: readonly string[]): void {
  for (const text of [notice.title, notice.summary]) {
    for (const token of forbidden) assert.equal(text.includes(token), false, `${notice.title} / ${notice.summary}`);
  }
}

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;

function failingRunRead(gate: { fail: boolean }): RepositoryWrap {
  return (repositories) => ({
    ...repositories,
    runs: {
      ...repositories.runs,
      get: (runId: string) => {
        if (gate.fail) throw new Error("injected run dependency failure");
        return repositories.runs.get(runId);
      },
    },
  });
}

async function world(wrap?: RepositoryWrap): Promise<{ harness: Harness; inbox: NotificationInbox; path: string }> {
  const profileCount = profiles.length;
  const harness = await createHarness(wrap);
  const profile = profiles[profileCount];
  assert.ok(profile);
  const inbox = createNotificationInbox({
    authority: harness.database,
    clock: harness.clock,
    ids: sequentialIdFactory("1"),
    actorId: "local-operator",
  });
  return { harness, inbox, path: profile.path };
}

function serviceFor(harness: Harness, inbox: NotificationInbox) {
  return createDashboardCommandService({
    kernel: harness.kernel,
    projection: { ingestFromTimeline() {}, refreshRun() {} },
    commandNotices: inbox,
  });
}

function startRun(harness: Harness, employeeId: string): string {
  const started = harness.kernel.execute(startCommand(createPlan(harness, rejectActiveDescriptor, [employeeId])));
  assert.equal(started.state, "applied");
  return singleAppliedRunId(started);
}

function acceptedBulk(harness: Harness, runIds: readonly string[]): BulkRunCommandRequest {
  const bulkCommandId = nextCommandId();
  const request = BulkRunCommandRequestSchema.parse({
    commandId: bulkCommandId,
    bulkCommandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "run",
    type: "cancel",
    mode: "best-effort",
    targets: runIds.map((runId) => {
      const run = harness.database.authority.runs.get(runId);
      assert.ok(run);
      return { runId, expectedVersion: run.version };
    }),
  });
  const accepted = harness.database.authority.commands.acceptBulk({
    bulkCommandId,
    requestFingerprint: deriveBulkRunCommandFingerprint(request),
    request,
  });
  assert.equal(accepted.state, "inserted");
  return request;
}

describe("bulk command notices", () => {
  it("stops a thrown child as bulk-child-errored, keeps one bulk-result notice, and replays that child as errored", async () => {
    const gate = { fail: false };
    const { harness, inbox, path } = await world(failingRunRead(gate));
    const firstRunId = startRun(harness, FIRST_EMPLOYEE_ID);
    const secondRunId = startRun(harness, SECOND_EMPLOYEE_ID);
    const firstVersion = harness.database.authority.runs.get(firstRunId)?.version;
    const secondVersion = harness.database.authority.runs.get(secondRunId)?.version;
    const request = acceptedBulk(harness, [firstRunId, secondRunId]);
    const service = serviceFor(harness, inbox);
    gate.fail = true;
    const first = await service.executeBulk(request);
    gate.fail = false;
    assert.equal(first.state, "vector");
    if (first.state !== "vector") return;
    assert.equal(first.results.length, 1);
    assert.equal(first.results[0]?.outcome, "errored");
    assert.equal(harness.database.authority.runs.get(firstRunId)?.version, firstVersion);
    assert.equal(harness.database.authority.runs.get(secondRunId)?.version, secondVersion);
    const childId = deriveBulkChildCommandId(request.bulkCommandId, firstRunId);
    assert.equal(first.results[0]?.commandId, childId);
    assert.deepEqual(commandJournal(path, childId), { state: "refused", audits: 1 });
    const audit = harness.database.authority.commandAudits.findByCommand(childId);
    assert.ok(audit);
    assert.equal(audit.result.state, "rejected");
    if (audit.result.state === "rejected") assert.equal(audit.result.code, "bulk-child-errored");
    assert.equal(harness.database.authority.commands.get(deriveBulkChildCommandId(request.bulkCommandId, secondRunId)), undefined);
    const notices = inbox.list("local-operator", "unread");
    assert.equal(notices.length, 1);
    const notice = notices[0];
    assert.ok(notice);
    assert.equal(notice.trigger, "command");
    assert.deepEqual(notice.links, [{ kind: "bulk-result", bulkCommandId: request.bulkCommandId }]);
    assert.equal(notice.summary, "1 failed · 1 not attempted");
    assertPrivate(notice, [FIRST_EMPLOYEE_ID, SECOND_EMPLOYEE_ID, `Kernel ${FIRST_EMPLOYEE_ID}`, `Kernel ${SECOND_EMPLOYEE_ID}`]);
    const stored = inbox.list("local-operator");
    const replayed = await service.executeBulk(request);
    assert.equal(replayed.state, "vector");
    if (replayed.state !== "vector") return;
    assert.equal(replayed.bulkCommandId, first.bulkCommandId);
    assert.equal(replayed.type, first.type);
    assert.equal(replayed.requestedCount, first.requestedCount);
    assert.equal(replayed.results.length, first.results.length);
    const firstChild = first.results[0];
    const replayChild = replayed.results[0];
    if (firstChild?.outcome !== "errored" || replayChild?.outcome !== "errored") {
      throw new Error("both deliveries report the child as errored");
    }
    assert.equal(firstChild.commandId, replayChild.commandId);
    assert.equal(firstChild.runId, replayChild.runId);
    assert.equal(firstChild.detail, "injected run dependency failure");
    assert.equal(replayChild.detail, ERROR_CATALOG.BULK_CHILD_ERRORED.text);
    assert.equal(harness.database.authority.runs.get(firstRunId)?.version, firstVersion);
    assert.equal(harness.database.authority.commands.get(deriveBulkChildCommandId(request.bulkCommandId, secondRunId)), undefined);
    assert.deepEqual(commandJournal(path, childId), { state: "refused", audits: 1 });
    assert.deepEqual(inbox.list("local-operator"), stored);
  });

  it("creates no notification when every bulk child is applied", async () => {
    const { harness, inbox } = await world();
    const firstRunId = startRun(harness, FIRST_EMPLOYEE_ID);
    const secondRunId = startRun(harness, SECOND_EMPLOYEE_ID);
    const request = acceptedBulk(harness, [firstRunId, secondRunId]);
    const vector = await serviceFor(harness, inbox).executeBulk(request);
    assert.equal(vector.state, "vector");
    if (vector.state !== "vector") return;
    assert.deepEqual(vector.results.map((result) => result.outcome), ["applied", "applied"]);
    assert.equal(inbox.list("local-operator").length, 0);
  });
});
