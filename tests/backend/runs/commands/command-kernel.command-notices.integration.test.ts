import { createCommandKernelTestWorld, type Harness } from "../../../support/helpers/backend/command-kernel-harness.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_EID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createNotificationInbox, type NotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { NotificationRecord } from "../../../../src/models/notifications/notifications.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";

const EMPLOYEE_ID = "10800000";
const SUBJECT_LABEL = `Kernel ${EMPLOYEE_ID}`;

const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, nextCommandId, createPlan, startCommand, runCommand } = createCommandKernelTestWorld();

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

async function noticedWorld(wrap?: RepositoryWrap): Promise<{ harness: Harness; inbox: NotificationInbox; path: string }> {
  const inboxRef: { current?: NotificationInbox } = {};
  const profileCount = profiles.length;
  const harness = await createHarness(wrap, {
    commandNotices: {
      record: (event) => {
        const inbox = inboxRef.current;
        if (inbox === undefined) throw new Error("command notice inbox is not ready");
        return inbox.record(event);
      },
    },
  });
  const profile = profiles[profileCount];
  assert.ok(profile);
  const inbox = createNotificationInbox({
    authority: harness.database,
    clock: harness.clock,
    ids: sequentialIdFactory("1"),
    actorId: "local-operator",
  });
  inboxRef.current = inbox;
  return { harness, inbox, path: profile.path };
}

function startRun(harness: Harness, employeeId: string): string {
  const started = harness.kernel.execute(startCommand(createPlan(harness, rejectActiveDescriptor, [employeeId])));
  assert.equal(started.state, "applied");
  return singleAppliedRunId(started);
}

function runVersion(harness: Harness, runId: string): number {
  const run = harness.database.authority.runs.get(runId);
  assert.ok(run);
  return run.version;
}

describe("command notices", () => {
  it("stores a rejected run command and replays it as one unread command-result notice", async () => {
    const { harness, inbox, path } = await noticedWorld();
    const runId = startRun(harness, EMPLOYEE_ID);
    const version = runVersion(harness, runId);
    const command = runCommand("retry", runId, version);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "rejected");
    assert.equal(runVersion(harness, runId), version);
    assert.deepEqual(commandJournal(path, command.commandId), { state: "refused", audits: 1 });
    const audit = harness.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(audit);
    assert.deepEqual(audit.result, first);
    const notices = inbox.list("local-operator", "unread");
    assert.equal(notices.length, 1);
    const notice = notices[0];
    assert.ok(notice);
    assert.equal(notice.trigger, "command");
    assert.deepEqual(notice.links, [{ kind: "command-result", commandId: command.commandId }]);
    assertPrivate(notice, [EMPLOYEE_ID, SUBJECT_LABEL]);
    const stored = inbox.list("local-operator");
    assert.deepEqual(harness.kernel.execute(command), first);
    assert.equal(runVersion(harness, runId), version);
    assert.deepEqual(commandJournal(path, command.commandId), { state: "refused", audits: 1 });
    assert.deepEqual(inbox.list("local-operator"), stored);
  });

  it("stores a conflicting run command and replays it as one unread command-result notice", async () => {
    const { harness, inbox, path } = await noticedWorld();
    const runId = startRun(harness, EMPLOYEE_ID);
    const version = runVersion(harness, runId);
    const command = runCommand("cancel", runId, version + 7);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "conflict");
    assert.equal(runVersion(harness, runId), version);
    assert.deepEqual(commandJournal(path, command.commandId), { state: "refused", audits: 1 });
    const audit = harness.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(audit);
    assert.deepEqual(audit.result, first);
    const notices = inbox.list("local-operator", "unread");
    assert.equal(notices.length, 1);
    const notice = notices[0];
    assert.ok(notice);
    assert.equal(notice.trigger, "command");
    assert.deepEqual(notice.links, [{ kind: "command-result", commandId: command.commandId }]);
    assertPrivate(notice, [EMPLOYEE_ID, SUBJECT_LABEL]);
    const stored = inbox.list("local-operator");
    assert.deepEqual(harness.kernel.execute(command), first);
    assert.equal(runVersion(harness, runId), version);
    assert.deepEqual(commandJournal(path, command.commandId), { state: "refused", audits: 1 });
    assert.deepEqual(inbox.list("local-operator"), stored);
  });

  it("stores a confirmation-required refusal and replays it with no notification", async () => {
    let inbox: NotificationInbox | undefined;
    const harness = await sourceBoundHarness(undefined, undefined, undefined, undefined, undefined, undefined, {
      record: (event) => {
        if (inbox === undefined) throw new Error("command notice inbox is not ready");
        return inbox.record(event);
      },
    });
    try {
      inbox = createNotificationInbox({
        authority: harness.database,
        clock: harness.clock,
        ids: sequentialIdFactory("1"),
        actorId: "local-operator",
      });
      const queued = harness.start(harness.proposal());
      harness.world.probeResults.push(absentProbeEvidence(harness.clock.now().toISOString()));
      const done = await harness.execute(queued);
      assert.equal(done.state, "done", JSON.stringify(done.state === "failed" ? harness.database.authority.failures.get(done.failureId) : done));
      const source = harness.fresh(queued);
      const plan = harness.proposal(source);
      assert.ok(plan.rerun);
      assert.ok(plan.rerun.warnings.length > 0);
      const command = harness.command(plan);
      const version = source.version;
      const runCount = harness.database.authority.runs.listByWorkflow(harness.descriptor.id).length;
      const first = harness.kernel.execute(command);
      assert.equal(first.state, "confirmation-required");
      assert.equal(harness.fresh(source).version, version);
      assert.equal(harness.database.authority.runs.listByWorkflow(harness.descriptor.id).length, runCount);
      assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
      assert.deepEqual(commandJournal(harness.authorityPath, command.commandId), { state: "refused", audits: 1 });
      const audit = harness.database.authority.commandAudits.findByCommand(command.commandId);
      assert.ok(audit);
      assert.deepEqual(audit.result, first);
      for (const notice of inbox.list("local-operator")) assertPrivate(notice, [WRITE_FIXTURE_EID]);
      assert.equal(inbox.list("local-operator").length, 0);
      assert.deepEqual(harness.kernel.execute(command), first);
      assert.equal(harness.fresh(source).version, version);
      assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
      assert.deepEqual(commandJournal(harness.authorityPath, command.commandId), { state: "refused", audits: 1 });
      for (const notice of inbox.list("local-operator")) assertPrivate(notice, [WRITE_FIXTURE_EID]);
      assert.equal(inbox.list("local-operator").length, 0);
    } finally {
      await harness.dispose();
    }
  });

  it("stores a notification-family refusal and replays it with no notification", async () => {
    const { harness, inbox, path } = await noticedWorld();
    const command = {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "notification",
      type: "notification-read",
      target: { notificationId: UUID_7, actorId: "local-operator", expectedVersion: 1 },
    };
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "rejected");
    if (first.state === "rejected") assert.equal(first.code, "target-not-found");
    assert.deepEqual(commandJournal(path, command.commandId), { state: "refused", audits: 1 });
    const audit = harness.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(audit);
    assert.deepEqual(audit.result, first);
    assert.equal(inbox.list("local-operator").length, 0);
    assert.deepEqual(harness.kernel.execute(command), first);
    assert.deepEqual(commandJournal(path, command.commandId), { state: "refused", audits: 1 });
    assert.equal(inbox.list("local-operator").length, 0);
  });

  it("leaves a thrown effect admitted with one recovery notice, then applies once when the dependency works", async () => {
    const gate = { fail: false };
    const wrappedReads = new WeakMap<AuthorityRepositories, AuthorityRepositories>();
    const failingRead: RepositoryWrap = (repositories) => {
      const cached = wrappedReads.get(repositories);
      if (cached !== undefined) return cached;
      const wrapped: AuthorityRepositories = {
        ...repositories,
        runs: {
          ...repositories.runs,
          get: (runId: string) => {
            if (gate.fail) throw new Error("injected run dependency failure");
            return repositories.runs.get(runId);
          },
        },
      };
      wrappedReads.set(repositories, wrapped);
      return wrapped;
    };
    const { harness, inbox, path } = await noticedWorld(failingRead);
    const runId = startRun(harness, EMPLOYEE_ID);
    const version = runVersion(harness, runId);
    const command = runCommand("cancel", runId, version);
    gate.fail = true;
    assert.throws(() => harness.kernel.execute(command), /injected run dependency failure/);
    assert.equal(runVersion(harness, runId), version);
    assert.deepEqual(commandJournal(path, command.commandId), { state: "admitted", audits: 0 });
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    const notices = inbox.list("local-operator", "unread");
    assert.equal(notices.length, 1);
    const notice = notices[0];
    assert.ok(notice);
    assert.equal(notice.trigger, "command");
    assert.deepEqual(notice.links, [{ kind: "recovery", commandId: command.commandId }]);
    assertPrivate(notice, [EMPLOYEE_ID, SUBJECT_LABEL]);
    gate.fail = false;
    const applied = harness.kernel.execute(command);
    assert.equal(applied.state, "applied");
    assert.equal(runVersion(harness, runId), version + 1);
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(runVersion(harness, runId), version + 1);
    assert.equal(commandJournal(path, command.commandId).audits, 1);
    assert.deepEqual(inbox.list("local-operator"), notices);
  });
});
