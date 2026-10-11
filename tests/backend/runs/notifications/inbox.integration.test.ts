import { RunRecordService as RunRecordService_m0 } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { seedSyntheticRuntimeConfig as seedSyntheticRuntimeConfig_m0 } from "../../../support/fixtures/operator-command-fixtures.js";

import assert_m0 from "node:assert/strict";
import { spawnSync as spawnSync_m1 } from "node:child_process";
import { mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,realpathSync as realpathSync_m0,rmSync as rmSync_m0,rmSync as rmSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { createCommandKernel as createCommandKernel_m0,type CommandKernel as CommandKernel_m0 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createNotificationInbox as createNotificationInbox_m1 } from "../../../../src/backend/runs/notifications/inbox.js";
import { NotificationRecordSchema as NotificationRecordSchema_m0 } from "../../../../src/models/notifications/notifications.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS as NO_INTAKE_PROJECTIONS_m0,UNWIRED_INTAKE_PARSER as UNWIRED_INTAKE_PARSER_m0 } from "../../../support/fixtures/intake-kernel-seams.js";
import { HASH_A as HASH_A_m0,LATER as LATER_m0,NOW as NOW_m0,UUID_2 as UUID_2_m0,UUID_7 as UUID_7_m0 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory as sequentialIdFactory_m0,sequentialIdFactory as sequentialIdFactory_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const ACTOR = "local-operator";

function record(overrides: Record<string, unknown> = {}) {
  return NotificationRecordSchema_m0.parse({
    notificationId: UUID_7_m0,
    actorId: ACTOR,
    dedupeFingerprint: HASH_A_m0,
    trigger: "failed",
    channel: "ping",
    status: "unread",
    snooze: { state: "not-snoozed" },
    title: "Run failed",
    summary: "person-lookup run failed at cross-verify",
    links: [{ kind: "run", runId: UUID_2_m0 }],
    count: 1,
    lastSeenAt: NOW_m0,
    version: 1,
    createdAt: NOW_m0,
    updatedAt: NOW_m0,
    ...overrides,
  });
}

function harness(): { database: AuthorityDatabase_m0; kernel: CommandKernel_m0 } {
  const clock = manualClock_m0(new Date(LATER_m0));
  const root = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "hrauto-inbox-"));
  disposers.push(() => rmSync_m0(root, { recursive: true, force: true }));
  const database = AuthorityDatabase_m0.open(
    { path: join_m0(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "inbox-test" },
    clock,
  );
  disposers.push(() => database.close());
  seedSyntheticRuntimeConfig_m0(database);
  const active = database.authority.runtimeConfig.get(); assert_m0.ok(active);
  const kernel = createCommandKernel_m0({
    lifecycle: new RunRecordService_m0({ database: database, clock: clock, ids: sequentialIdFactory_m0("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
    intakeParser: UNWIRED_INTAKE_PARSER_m0,
    intakeProjections: NO_INTAKE_PROJECTIONS_m0,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(repositories),
      ),
    },
    clock,
    ids: sequentialIdFactory_m0("c"),
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
    requestedAt: LATER_m0,
    requestedBy: ACTOR,
    source: "notification-bell",
    family: "notification",
    type,
    target: { notificationId: UUID_7_m0, actorId: ACTOR, expectedVersion },
    ...extra,
  };
}

describe_m0("notification lifecycle arms", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("refuses a crafted mark-read command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-read", 1));

    assert_m0.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert_m0.equal(result.code, "policy-refused");
      assert_m0.match(result.message, /pinned backfill gap/u);
    }
    const unchanged = database.authority.notifications.get(UUID_7_m0);
    assert_m0.equal(unchanged?.status, "unread");
    assert_m0.equal(unchanged?.version, 1);
  });

  it_m0("refuses a crafted snooze command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-snooze", 1));

    assert_m0.equal(result.state, "rejected");
    if (result.state === "rejected") assert_m0.equal(result.code, "policy-refused");
    const unchanged = database.authority.notifications.get(UUID_7_m0);
    assert_m0.deepEqual(unchanged?.snooze, { state: "not-snoozed" });
    assert_m0.equal(unchanged?.version, 1);
  });

  it_m0("refuses a crafted same-state mark-unread command for a pinned backfill gap", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      trigger: "backfill-gap",
      links: [],
    }));

    const result = kernel.execute(command("notification-unread", 1));

    assert_m0.equal(result.state, "rejected");
    if (result.state === "rejected") assert_m0.equal(result.code, "policy-refused");
    assert_m0.equal(database.authority.notifications.get(UUID_7_m0)?.version, 1);
  });

  it_m0("marks read preserving the snooze, and unread preserving it too", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      snooze: { state: "snoozed", until: "2026-07-31T18:00:00.000Z" },
    }));

    assert_m0.equal(kernel.execute(command("notification-read", 1)).state, "applied");
    const read = database.authority.notifications.get(UUID_7_m0);
    assert_m0.equal(read?.status, "read");
    assert_m0.deepEqual(read?.snooze, { state: "snoozed", until: "2026-07-31T18:00:00.000Z" });

    assert_m0.equal(kernel.execute(command("notification-unread", 2)).state, "applied");
    assert_m0.equal(database.authority.notifications.get(UUID_7_m0)?.status, "unread");
  });

  it_m0("snoozes for one backend-clock hour, preserving read state, then unsnoozes", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({ status: "read", version: 1 }));

    const snoozed = kernel.execute(command("notification-snooze", 1));
    assert_m0.equal(snoozed.state, "applied");
    const row = database.authority.notifications.get(UUID_7_m0);
    assert_m0.equal(row?.status, "read");
    assert_m0.deepEqual(row?.snooze, { state: "snoozed", until: "2026-07-31T18:01:00.000Z" });

    const before = database.getMeta().authorityGeneration;
    assert_m0.throws(() => kernel.execute(command("notification-snooze", 2, { payload: { until: NOW_m0 } })));
    assert_m0.equal(database.getMeta().authorityGeneration, before);
    assert_m0.equal(kernel.execute(command("notification-unsnooze", 2)).state, "applied");
    assert_m0.deepEqual(database.authority.notifications.get(UUID_7_m0)?.snooze, { state: "not-snoozed" });
  });

  it_m0("rejects a stale version and a foreign actor", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record());

    const stale = kernel.execute(command("notification-read", 7));
    assert_m0.equal(stale.state, "rejected");
    if (stale.state === "rejected") assert_m0.match(stale.message, /reload the inbox/u);

    const foreign = kernel.execute({
      ...command("notification-read", 1),
      target: { notificationId: UUID_7_m0, actorId: "other-operator", expectedVersion: 1 },
    });
    assert_m0.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert_m0.match(foreign.message, /target actor does not match/u);
  });
});
}

{


const roots: string[] = [];
const _afterEachFixture0 = () => roots.splice(0).forEach(root => rmSync_m1(root, { recursive: true, force: true }));
const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
function harness() {
  const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "notification-publication-")); roots.push(root);
  const clock = manualClock_m1(new Date("2026-09-14T12:00:00Z"));
  const path = join_m1(root, "state.db");
  const open = () => AuthorityDatabase_m1.open({ path, busyTimeoutMs: 250, migrationOwner: "notification-test" }, clock);
  const inbox = (db: AuthorityDatabase_m1) => createNotificationInbox_m1({ authority: db, clock, ids: sequentialIdFactory_m1("a"), actorId: "local-operator" });
  return { open, inbox, clock, path };
}
describe_m1("durable notification publication", () => {
afterEach_m1(_afterEachFixture0);

  it_m1.each(["before", "after"])("survives process death %s publication commit", boundary => {
    const f = harness(); const initial = f.open(); initial.close();
    const script = `
      import { AuthorityDatabase } from ${JSON.stringify(join_m1(process.cwd(), "tests/support/helpers/synthetic-storage-admission.ts"))};
      import { manualClock } from ${JSON.stringify(join_m1(process.cwd(), "src/rules/time/clock.ts"))};
      import { createNotificationInbox } from ${JSON.stringify(join_m1(process.cwd(), "src/backend/runs/notifications/inbox.ts"))};
      const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
      const db = AuthorityDatabase.open({path:process.argv[1],busyTimeoutMs:250,migrationOwner:"crash-proof"},clock);
      const inbox = createNotificationInbox({authority:db,clock,ids:{uuid:()=>"00000000-0000-4000-8000-000000000991"},actorId:"local-operator"});
      const event = ${JSON.stringify(event)};
      if(process.argv[2]==="before") db.withAuthorityTransaction(()=>{void inbox.publish(event);process.exit(71);});
      else {await inbox.publish(event);process.exit(72);}
    `;
    const child = spawnSync_m1(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, f.path, boundary], { cwd: process.cwd(), encoding: "utf8" });
    expect_m1(child.status, child.stderr).toBe(boundary === "before" ? 71 : 72);
    const db = f.open();
    try {
      expect_m1(db.authority.notificationPublications.list()).toHaveLength(boundary === "before" ? 0 : 1);
      expect_m1(db.authority.notifications.listByActor("local-operator")).toHaveLength(boundary === "before" ? 0 : 1);
    } finally { db.close(); }
  });
  it_m1("adopts historical occurrences without resetting the existing operator row", async () => {
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
      expect_m1(report.durable).toBe("existing"); expect_m1(report.notification).toEqual(record);
      expect_m1(db.authority.notificationPublications.latest(record.notificationId)).toBeUndefined();
    } finally { db.close(); }
  });
  it_m1("retains a committed source without an OS delivery channel across restart", async () => {
    const f = harness(); let db = f.open();
    try {
      const inbox = f.inbox(db);
      expect_m1((await inbox.publish(event)).delivery.state).toBe("no-channel");
      db.close(); db = f.open(); expect_m1((await f.inbox(db).publish(event)).durable).toBe("existing");
    } finally { db.close(); }
  });

  it_m1("commits one occurrence under concurrent replay and preserves read/snooze across restart", async () => {
    const f = harness(); let db = f.open();
    try {
      const inbox = f.inbox(db);
      const reports = await Promise.all([inbox.publish(event), inbox.publish(event)]);
      expect_m1(reports.map(row => row.durable)).toEqual(["created", "existing"]);
      const id = reports[0].notification.notificationId;
      inbox.markRead(id, 1); inbox.snooze(id, 2, "2026-09-15T12:00:00Z");
      const before = inbox.get(id);
      db.close(); db = f.open();
      expect_m1((await f.inbox(db).publish(event)).notification).toEqual(before);
    } finally { db.close(); }
  });
  it_m1("rolls back source and row together, then folds each distinct source once", async () => {
    const f = harness(), db = f.open();
    try {
      const inbox = f.inbox(db);
      const first = await inbox.publish(event);
      await inbox.publish(event, { identity: "b".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect_m1(inbox.get(first.notification.notificationId)?.count).toBe(2);
      const before = db.authority.notificationPublications.list();
      expect_m1(() => db.withAuthorityTransaction(repos => {
        repos.notificationPublications.create({ ...before[0], sourceId: "c".repeat(64) });
        throw new Error("crash-before-commit");
      })).toThrow("crash-before-commit");
      expect_m1(db.authority.notificationPublications.list()).toEqual(before);
      await inbox.publish(event, { identity: "b".repeat(64), occurredAt: f.clock.now().toISOString() });
      expect_m1(inbox.get(first.notification.notificationId)?.count).toBe(2);
    } finally { db.close(); }
  });
});
}
