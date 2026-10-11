import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { seedSyntheticRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandKernel, type CommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { HASH_A, LATER, NOW, UUID_2, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

{

const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const ACTOR = "local-operator";

function record(overrides: Record<string, unknown> = {}) {
  return NotificationRecordSchema.parse({
    notificationId: UUID_7,
    actorId: ACTOR,
    dedupeFingerprint: HASH_A,
    trigger: "failed",
    channel: "ping",
    status: "unread",
    snooze: { state: "not-snoozed" },
    title: "Run failed",
    summary: "person-lookup run failed at cross-verify",
    links: [{ kind: "run", runId: UUID_2 }],
    count: 1,
    lastSeenAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function harness(): { database: AuthorityDatabase; kernel: CommandKernel } {
  const clock = manualClock(new Date(LATER));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-inbox-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "inbox-test" },
    clock,
  );
  disposers.push(() => database.close());
  seedSyntheticRuntimeConfig(database);
  const active = database.authority.runtimeConfig.get(); assert.ok(active);
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(repositories),
      ),
    },
    clock,
    ids: sequentialIdFactory("c"),
    descriptors: { resolve: () => undefined },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("unexpected worker command"); }, spawnPoolWorker: () => { throw new Error("unexpected worker command"); }, refreshPoolBrowser: () => { throw new Error("unexpected worker command"); }, reopenPoolBrowser: () => { throw new Error("unexpected worker command"); }, stopPoolWorker: () => { throw new Error("unexpected worker command"); }, pausePoolWorker: () => { throw new Error("unexpected worker command"); }, resumePoolWorker: () => { throw new Error("unexpected worker command"); } } },
  });
  return { database, kernel };
}

let sequence = 0;
function command(type: string, expectedVersion: number, extra: Record<string, unknown> = {}) {
  sequence += 1;
  const tail = String(sequence).padStart(4, "0");
  return {
    commandId: `eeeeeeee-${tail}-4000-8000-${tail}00000000`,
    requestedAt: LATER,
    requestedBy: ACTOR,
    source: "notification-bell",
    family: "notification",
    type,
    target: { notificationId: UUID_7, actorId: ACTOR, expectedVersion },
    ...extra,
  };
}

describe("notification lifecycle arms", () => {
afterEach(_afterEachFixture0);

  it("refuses a crafted mark-read command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-read", 1));

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, "policy-refused");
      assert.match(result.message, /pinned backfill gap/u);
    }
    const unchanged = database.authority.notifications.get(UUID_7);
    assert.equal(unchanged?.status, "unread");
    assert.equal(unchanged?.version, 1);
  });

  it("refuses a crafted snooze command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-snooze", 1));

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "policy-refused");
    const unchanged = database.authority.notifications.get(UUID_7);
    assert.deepEqual(unchanged?.snooze, { state: "not-snoozed" });
    assert.equal(unchanged?.version, 1);
  });

  it("refuses a crafted same-state mark-unread command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-unread", 1));

    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "policy-refused");
    assert.equal(database.authority.notifications.get(UUID_7)?.version, 1);
  });

  it("marks read preserving the snooze, and unread preserving it too", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      snooze: { state: "snoozed", until: "2026-07-31T18:00:00.000Z" },
    }));

    assert.equal(kernel.execute(command("notification-read", 1)).state, "applied");
    const read = database.authority.notifications.get(UUID_7);
    assert.equal(read?.status, "read");
    assert.deepEqual(read?.snooze, { state: "snoozed", until: "2026-07-31T18:00:00.000Z" });

    assert.equal(kernel.execute(command("notification-unread", 2)).state, "applied");
    assert.equal(database.authority.notifications.get(UUID_7)?.status, "unread");
  });

  it("snoozes for one backend-clock hour, preserving read state, then unsnoozes", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({ status: "read", version: 1 }));

    const snoozed = kernel.execute(command("notification-snooze", 1));
    assert.equal(snoozed.state, "applied");
    const row = database.authority.notifications.get(UUID_7);
    assert.equal(row?.status, "read");
    assert.deepEqual(row?.snooze, { state: "snoozed", until: "2026-07-31T18:01:00.000Z" });

    const before = database.getMeta().authorityGeneration;
    assert.throws(() => kernel.execute(command("notification-snooze", 2, { payload: { until: NOW } })));
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(kernel.execute(command("notification-unsnooze", 2)).state, "applied");
    assert.deepEqual(database.authority.notifications.get(UUID_7)?.snooze, { state: "not-snoozed" });
  });

  it("rejects a stale version and a foreign actor", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record());

    const stale = kernel.execute(command("notification-read", 7));
    assert.equal(stale.state, "rejected");
    if (stale.state === "rejected") assert.match(stale.message, /reload the inbox/u);

    const foreign = kernel.execute({
      ...command("notification-read", 1),
      target: { notificationId: UUID_7, actorId: "other-operator", expectedVersion: 1 },
    });
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.match(foreign.message, /target actor does not match/u);
  });
});
}

{

const roots: string[] = [];
const _afterEachFixture0 = () => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
function harness() {
  const root = mkdtempSync(join(tmpdir(), "notification-publication-")); roots.push(root);
  const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
  const path = join(root, "state.db");
  const open = () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "notification-test" }, clock);
  const inbox = (db: AuthorityDatabase) => createNotificationInbox({ authority: db, clock, ids: sequentialIdFactory("a"), actorId: "local-operator" });
  return { open, inbox, clock, path };
}
describe("durable notification publication", () => {
afterEach(_afterEachFixture0);

  it.each(["before", "after"])("survives process death %s publication commit", boundary => {
    const f = harness(); const initial = f.open(); initial.close();
    const script = `
      import { AuthorityDatabase } from ${JSON.stringify(join(process.cwd(), "tests/support/helpers/synthetic-storage-admission.ts"))};
      import { manualClock } from ${JSON.stringify(join(process.cwd(), "src/rules/time/clock.ts"))};
      import { createNotificationInbox } from ${JSON.stringify(join(process.cwd(), "src/backend/runs/notifications/inbox.ts"))};
      const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
      const db = AuthorityDatabase.open({path:process.argv[1],busyTimeoutMs:250,migrationOwner:"crash-proof"},clock);
      const inbox = createNotificationInbox({authority:db,clock,ids:{uuid:()=>"00000000-0000-4000-8000-000000000991"},actorId:"local-operator"});
      const event = ${JSON.stringify(event)};
      if(process.argv[2]==="before") db.withAuthorityTransaction(()=>{void inbox.publish(event);process.exit(71);});
      else {await inbox.publish(event);process.exit(72);}
    `;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, f.path, boundary], { cwd: process.cwd(), encoding: "utf8" });
    expect(child.status, child.stderr).toBe(boundary === "before" ? 71 : 72);
    const db = f.open();
    try {
      expect(db.authority.notificationPublications.list()).toHaveLength(boundary === "before" ? 0 : 1);
      expect(db.authority.notifications.listByActor("local-operator")).toHaveLength(boundary === "before" ? 0 : 1);
    } finally { db.close(); }
  });
  it("adopts historical occurrences without resetting the existing operator row", async () => {
    const f = harness(), db = f.open();
    try {
      const inbox = f.inbox(db);
      const { projectNotificationTrigger } = await import("../../../../src/rules/notifications/notification-triggers.js");
      const projection = projectNotificationTrigger(event);
      const record = { ...projection, notificationId: "00000000-0000-4000-8000-000000000123", actorId: "local-operator", status: "read",
        snooze: { state: "snoozed", until: "2026-09-15T12:00:00Z" }, count: 4, version: 7,
        lastSeenAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), updatedAt: f.clock.now().toISOString() };
      db.authority.notifications.create(record);
      const report = await inbox.publish(event, { identity: "d".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect(report.durable).toBe("existing"); expect(report.notification).toEqual(record);
      expect(db.authority.notificationPublications.latest(record.notificationId)).toBeUndefined();
    } finally { db.close(); }
  });
  it("retains a committed source without an OS delivery channel across restart", async () => {
    const f = harness(); let db = f.open();
    try {
      const inbox = f.inbox(db);
      expect((await inbox.publish(event)).delivery.state).toBe("no-channel");
      db.close(); db = f.open(); expect((await f.inbox(db).publish(event)).durable).toBe("existing");
    } finally { db.close(); }
  });

  it("commits one occurrence under concurrent replay and preserves read/snooze across restart", async () => {
    const f = harness(); let db = f.open();
    try {
      const inbox = f.inbox(db);
      const reports = await Promise.all([inbox.publish(event), inbox.publish(event)]);
      expect(reports.map(row => row.durable)).toEqual(["created", "existing"]);
      const id = reports[0].notification.notificationId;
      inbox.markRead(id, 1); inbox.snooze(id, 2, "2026-09-15T12:00:00Z");
      const before = inbox.get(id);
      db.close(); db = f.open();
      expect((await f.inbox(db).publish(event)).notification).toEqual(before);
    } finally { db.close(); }
  });
  it("rolls back source and row together, then folds each distinct source once", async () => {
    const f = harness(), db = f.open();
    try {
      const inbox = f.inbox(db);
      const first = await inbox.publish(event);
      await inbox.publish(event, { identity: "b".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect(inbox.get(first.notification.notificationId)?.count).toBe(2);
      const before = db.authority.notificationPublications.list();
      expect(() => db.withAuthorityTransaction(repos => {
        repos.notificationPublications.create({ ...before[0], sourceId: "c".repeat(64) });
        throw new Error("crash-before-commit");
      })).toThrow("crash-before-commit");
      expect(db.authority.notificationPublications.list()).toEqual(before);
      await inbox.publish(event, { identity: "b".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect(inbox.get(first.notification.notificationId)?.count).toBe(2);
    } finally { db.close(); }
  });
});
}
